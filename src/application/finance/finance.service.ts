import type {
  Account,
  AccountType,
  Prisma,
  PrismaClient,
  TransactionType,
} from '@prisma/client'

import {
  calculateBudgetProgress,
  resolveYearMonthRangeUtc,
  type BudgetAlertLevel,
} from '../budgets/budget-utils.js'
import { dayjs } from '../shared/time/dayjs.js'
import { resolvePeriodRange, type Period } from '../shared/time/period-range.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

interface WorkspaceScope {
  workspaceId: string
  timezone: string
}

interface CreateAccountInput {
  name: string
  type: AccountType
  initialBalance?: number
}

interface UpdateAccountInput {
  name?: string
  type?: AccountType
  isArchived?: boolean
}

interface CreateCategoryInput {
  name: string
  type: TransactionType
  color?: string
  icon?: string
}

interface UpdateCategoryInput {
  name?: string
  type?: TransactionType
  color?: string
  icon?: string
}

interface CreateTransactionInput {
  accountId: string
  categoryId?: string
  type: TransactionType
  amount: number
  description?: string
  notes?: string
  occurredAt: string
  tags?: string[]
}

interface UpdateTransactionInput {
  accountId?: string
  categoryId?: string | null
  type?: TransactionType
  amount?: number
  description?: string | null
  notes?: string | null
  occurredAt?: string
  tags?: string[]
}

interface CreateTransferInput {
  fromAccountId: string
  toAccountId: string
  amount: number
  description?: string
  transferredAt: string
}

interface DateRangeFilter {
  period?: Period
  from?: string
  to?: string
  anchorDate?: string
}

interface ListTransactionsFilter extends DateRangeFilter {
  type?: TransactionType
  accountId?: string
  categoryId?: string
  tag?: string
  createdByUserId?: string
  page?: number
  pageSize?: number
}

interface ListTransfersFilter extends DateRangeFilter {
  accountId?: string
}

export interface BudgetAlert {
  budgetId: string
  categoryId: string
  yearMonth: string
  limitAmount: number
  spentAmount: number
  remainingAmount: number
  usedPercent: number
  alertLevel: Exclude<BudgetAlertLevel, 'OK'>
}

interface TransactionMutationResult<TTransaction> {
  transaction: TTransaction
  alertasPresupuesto: BudgetAlert[]
}

const assertPositiveAmount = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'MONTO_INVALIDO', `${fieldName} debe ser entero positivo`) 
  }
}

const parseDate = (raw: string, fieldName: string): Date => {
  const parsed = new Date(raw)

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'FECHA_INVALIDA', `${fieldName} no tiene un formato válido`)
  }

  return parsed
}

const normalizeTag = (tag: string): string => {
  return tag.trim().toLowerCase()
}

const sanitizeTags = (tags: string[] | undefined): string[] => {
  if (!tags || tags.length === 0) {
    return []
  }

  const dedup = new Set<string>()

  for (const rawTag of tags) {
    const value = normalizeTag(rawTag)

    if (value.length === 0) {
      continue
    }

    dedup.add(value)
  }

  return [...dedup]
}

export class FinanceService {
  constructor(private readonly prisma: PrismaClient) {}

  private toYearMonth(occurredAt: Date, timezone: string): string {
    return dayjs(occurredAt).tz(timezone).format('YYYY-MM')
  }

  private async evaluateBudgetAlertsForExpense(
    tx: Prisma.TransactionClient,
    scope: WorkspaceScope,
    params: {
      type: TransactionType
      categoryId: string | null
      occurredAt: Date
    },
  ): Promise<BudgetAlert[]> {
    if (params.type !== 'EXPENSE' || !params.categoryId) {
      return []
    }

    const yearMonth = this.toYearMonth(params.occurredAt, scope.timezone)
    const budget = await tx.budget.findFirst({
      where: {
        workspaceId: scope.workspaceId,
        categoryId: params.categoryId,
        yearMonth,
        deletedAt: null,
      },
      select: {
        id: true,
        categoryId: true,
        yearMonth: true,
        limitAmount: true,
      },
    })

    if (!budget) {
      return []
    }

    const { fromUtc, toUtc } = resolveYearMonthRangeUtc(yearMonth, scope.timezone)

    const spentAggregate = await tx.transaction.aggregate({
      where: {
        workspaceId: scope.workspaceId,
        type: 'EXPENSE',
        categoryId: params.categoryId,
        deletedAt: null,
        occurredAt: {
          gte: fromUtc,
          lte: toUtc,
        },
      },
      _sum: {
        amount: true,
      },
    })

    const progress = calculateBudgetProgress(budget.limitAmount, spentAggregate._sum.amount ?? 0)

    if (progress.alertLevel === 'OK') {
      return []
    }

    return [
      {
        budgetId: budget.id,
        categoryId: budget.categoryId,
        yearMonth: budget.yearMonth,
        limitAmount: budget.limitAmount,
        spentAmount: progress.spentAmount,
        remainingAmount: progress.remainingAmount,
        usedPercent: progress.usedPercent,
        alertLevel: progress.alertLevel,
      },
    ]
  }

  private async getAccountOrThrow(workspaceId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: {
        id: accountId,
        workspaceId,
        deletedAt: null,
      },
    })

    if (!account) {
      throw new HttpError(404, 'CUENTA_NO_ENCONTRADA', 'La cuenta no existe')
    }

    return account
  }

  private async validateCategory(
    workspaceId: string,
    categoryId: string,
    type: TransactionType,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        workspaceId,
        deletedAt: null,
      },
    })

    if (!category) {
      throw new HttpError(404, 'CATEGORIA_NO_ENCONTRADA', 'La categoría no existe')
    }

    if (category.type !== type) {
      throw new HttpError(
        400,
        'CATEGORIA_TIPO_INVALIDO',
        'La categoría no coincide con el tipo de movimiento',
      )
    }
  }

  private async resolveTagIds(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    tags: string[],
  ): Promise<string[]> {
    if (tags.length === 0) {
      return []
    }

    const existingTags = await tx.transactionTag.findMany({
      where: {
        workspaceId,
        name: {
          in: tags,
        },
      },
    })

    const existingByName = new Map(existingTags.map((tag) => [tag.name, tag]))

    const ids: string[] = []

    for (const tagName of tags) {
      const existing = existingByName.get(tagName)

      if (existing) {
        if (existing.deletedAt) {
          const restored = await tx.transactionTag.update({
            where: {
              id: existing.id,
            },
            data: {
              deletedAt: null,
            },
          })
          ids.push(restored.id)
          continue
        }

        ids.push(existing.id)
        continue
      }

      const created = await tx.transactionTag.create({
        data: {
          workspaceId,
          name: tagName,
        },
      })

      ids.push(created.id)
    }

    return ids
  }

  async createAccount(
    scope: WorkspaceScope,
    userId: string,
    input: CreateAccountInput,
  ): Promise<Account> {
    const initialBalance = input.initialBalance ?? 0

    if (!Number.isInteger(initialBalance)) {
      throw new HttpError(400, 'SALDO_INICIAL_INVALIDO', 'initialBalance debe ser un entero')
    }

    const account = await this.prisma.account.create({
      data: {
        workspaceId: scope.workspaceId,
        createdByUserId: userId,
        name: input.name.trim(),
        type: input.type,
        initialBalance,
      },
    })

    return account
  }

  async listAccounts(scope: WorkspaceScope): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async updateAccount(
    scope: WorkspaceScope,
    accountId: string,
    input: UpdateAccountInput,
  ): Promise<Account> {
    await this.getAccountOrThrow(scope.workspaceId, accountId)

    return this.prisma.account.update({
      where: {
        id: accountId,
      },
      data: {
        name: input.name?.trim(),
        type: input.type,
        isArchived: input.isArchived,
      },
    })
  }

  async deleteAccount(scope: WorkspaceScope, accountId: string): Promise<void> {
    await this.getAccountOrThrow(scope.workspaceId, accountId)

    await this.prisma.account.update({
      where: {
        id: accountId,
      },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  async createCategory(
    scope: WorkspaceScope,
    userId: string,
    input: CreateCategoryInput,
  ) {
    const category = await this.prisma.category.create({
      data: {
        workspaceId: scope.workspaceId,
        createdByUserId: userId,
        name: input.name.trim(),
        type: input.type,
        color: input.color,
        icon: input.icon,
      },
    })

    return category
  }

  async listCategories(scope: WorkspaceScope) {
    return this.prisma.category.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      orderBy: [{ type: 'asc' }, { isSystem: 'desc' }, { name: 'asc' }],
    })
  }

  async updateCategory(
    scope: WorkspaceScope,
    categoryId: string,
    input: UpdateCategoryInput,
  ) {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
    })

    if (!category) {
      throw new HttpError(404, 'CATEGORIA_NO_ENCONTRADA', 'La categoría no existe')
    }

    if (category.isSystem) {
      throw new HttpError(400, 'CATEGORIA_SISTEMA', 'No se pueden editar categorías de sistema')
    }

    return this.prisma.category.update({
      where: {
        id: categoryId,
      },
      data: {
        name: input.name?.trim(),
        type: input.type,
        color: input.color,
        icon: input.icon,
      },
    })
  }

  async deleteCategory(scope: WorkspaceScope, categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
    })

    if (!category) {
      throw new HttpError(404, 'CATEGORIA_NO_ENCONTRADA', 'La categoría no existe')
    }

    if (category.isSystem) {
      throw new HttpError(
        400,
        'CATEGORIA_SISTEMA',
        'No se pueden eliminar categorías de sistema',
      )
    }

    await this.prisma.category.update({
      where: {
        id: category.id,
      },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  async createTransaction(
    scope: WorkspaceScope,
    userId: string,
    input: CreateTransactionInput,
  ): Promise<TransactionMutationResult<unknown>> {
    assertPositiveAmount(input.amount, 'amount')

    await this.getAccountOrThrow(scope.workspaceId, input.accountId)

    if (input.categoryId) {
      await this.validateCategory(scope.workspaceId, input.categoryId, input.type)
    }

    const occurredAt = parseDate(input.occurredAt, 'occurredAt')
    const tags = sanitizeTags(input.tags)

    return this.prisma.$transaction(async (tx) => {
      const tagIds = await this.resolveTagIds(tx, scope.workspaceId, tags)

      const transaction = await tx.transaction.create({
        data: {
          workspaceId: scope.workspaceId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          createdByUserId: userId,
          type: input.type,
          amount: input.amount,
          description: input.description?.trim(),
          notes: input.notes?.trim(),
          occurredAt,
          tags: {
            connect: tagIds.map((id) => ({ id })),
          },
        },
        include: {
          tags: true,
          category: true,
          account: true,
        },
      })

      const alertasPresupuesto = await this.evaluateBudgetAlertsForExpense(tx, scope, {
        type: transaction.type,
        categoryId: transaction.categoryId,
        occurredAt: transaction.occurredAt,
      })

      return {
        transaction,
        alertasPresupuesto,
      }
    })
  }

  async listTransactions(scope: WorkspaceScope, filters: ListTransactionsFilter) {
    const page = filters.page && filters.page > 0 ? filters.page : 1
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20

    const { fromUtc, toUtc } = resolvePeriodRange({
      timezone: scope.timezone,
      period: filters.period,
      from: filters.from,
      to: filters.to,
      anchorDate: filters.anchorDate,
    })

    const where: Prisma.TransactionWhereInput = {
      workspaceId: scope.workspaceId,
      deletedAt: null,
      occurredAt: {
        gte: fromUtc,
        lte: toUtc,
      },
      type: filters.type,
      accountId: filters.accountId,
      categoryId: filters.categoryId,
      createdByUserId: filters.createdByUserId,
      tags: filters.tag
        ? {
            some: {
              name: normalizeTag(filters.tag),
              deletedAt: null,
            },
          }
        : undefined,
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        include: {
          tags: {
            where: {
              deletedAt: null,
            },
          },
          category: true,
          account: true,
          createdByUser: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      range: {
        from: fromUtc,
        to: toUtc,
      },
    }
  }

  async updateTransaction(
    scope: WorkspaceScope,
    transactionId: string,
    input: UpdateTransactionInput,
  ): Promise<TransactionMutationResult<unknown>> {
    const existing = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      include: {
        tags: true,
      },
    })

    if (!existing) {
      throw new HttpError(404, 'MOVIMIENTO_NO_ENCONTRADO', 'El movimiento no existe')
    }

    const nextType = input.type ?? existing.type

    if (input.accountId) {
      await this.getAccountOrThrow(scope.workspaceId, input.accountId)
    }

    if (typeof input.amount === 'number') {
      assertPositiveAmount(input.amount, 'amount')
    }

    if (typeof input.categoryId === 'string') {
      await this.validateCategory(scope.workspaceId, input.categoryId, nextType)
    }

    if (input.categoryId === null) {
      // Permitir quitar categoría explícitamente
    }

    const tags = input.tags ? sanitizeTags(input.tags) : undefined

    return this.prisma.$transaction(async (tx) => {
      const tagIds = tags
        ? await this.resolveTagIds(tx, scope.workspaceId, tags)
        : existing.tags.map((tag) => tag.id)

      const updated = await tx.transaction.update({
        where: {
          id: transactionId,
        },
        data: {
          accountId: input.accountId,
          categoryId: input.categoryId === undefined ? undefined : input.categoryId,
          type: input.type,
          amount: input.amount,
          description:
            input.description === undefined ? undefined : input.description?.trim() ?? null,
          notes: input.notes === undefined ? undefined : input.notes?.trim() ?? null,
          occurredAt: input.occurredAt
            ? parseDate(input.occurredAt, 'occurredAt')
            : undefined,
          tags: {
            set: tagIds.map((id) => ({ id })),
          },
        },
        include: {
          tags: {
            where: {
              deletedAt: null,
            },
          },
          category: true,
          account: true,
        },
      })

      const alertasPresupuesto = await this.evaluateBudgetAlertsForExpense(tx, scope, {
        type: updated.type,
        categoryId: updated.categoryId,
        occurredAt: updated.occurredAt,
      })

      return {
        transaction: updated,
        alertasPresupuesto,
      }
    })
  }

  async deleteTransaction(scope: WorkspaceScope, transactionId: string): Promise<void> {
    const existing = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    })

    if (!existing) {
      throw new HttpError(404, 'MOVIMIENTO_NO_ENCONTRADO', 'El movimiento no existe')
    }

    await this.prisma.transaction.update({
      where: {
        id: transactionId,
      },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  async createTransfer(
    scope: WorkspaceScope,
    userId: string,
    input: CreateTransferInput,
  ) {
    assertPositiveAmount(input.amount, 'amount')

    if (input.fromAccountId === input.toAccountId) {
      throw new HttpError(
        400,
        'TRANSFERENCIA_INVALIDA',
        'La cuenta origen y destino deben ser diferentes',
      )
    }

    await this.getAccountOrThrow(scope.workspaceId, input.fromAccountId)
    await this.getAccountOrThrow(scope.workspaceId, input.toAccountId)

    return this.prisma.accountTransfer.create({
      data: {
        workspaceId: scope.workspaceId,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: input.amount,
        description: input.description?.trim(),
        transferredAt: parseDate(input.transferredAt, 'transferredAt'),
        createdByUserId: userId,
      },
      include: {
        fromAccount: true,
        toAccount: true,
      },
    })
  }

  async listTransfers(scope: WorkspaceScope, filters: ListTransfersFilter) {
    const { fromUtc, toUtc } = resolvePeriodRange({
      timezone: scope.timezone,
      period: filters.period,
      from: filters.from,
      to: filters.to,
      anchorDate: filters.anchorDate,
    })

    return this.prisma.accountTransfer.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        transferredAt: {
          gte: fromUtc,
          lte: toUtc,
        },
        OR: filters.accountId
          ? [{ fromAccountId: filters.accountId }, { toAccountId: filters.accountId }]
          : undefined,
      },
      include: {
        fromAccount: true,
        toAccount: true,
        createdByUser: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: [{ transferredAt: 'desc' }, { createdAt: 'desc' }],
    })
  }
}
