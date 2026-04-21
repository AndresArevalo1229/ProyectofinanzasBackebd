import type { Budget, PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'

import {
  calculateBudgetProgress,
  resolveYearMonth,
  resolveYearMonthRangeUtc,
  type BudgetProgress,
} from './budget-utils.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

interface WorkspaceScope {
  workspaceId: string
  timezone: string
}

interface CreateBudgetInput {
  categoryId: string
  yearMonth?: string
  limitAmount: number
  notes?: string
}

interface UpdateBudgetInput {
  categoryId?: string
  yearMonth?: string
  limitAmount?: number
  notes?: string | null
}

interface BudgetView {
  id: string
  workspaceId: string
  categoryId: string
  yearMonth: string
  limitAmount: number
  notes: string | null
  progress: BudgetProgress
}

interface BudgetSummary {
  yearMonth: string
  totalBudgeted: number
  totalSpent: number
  totalRemaining: number
  warningCount: number
  exceededCount: number
}

interface ListBudgetsFilter {
  yearMonth?: string
}

const assertPositiveAmount = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'PRESUPUESTO_MONTO_INVALIDO', `${fieldName} debe ser entero positivo`)
  }
}

const isUniqueConstraintError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>
    return candidate.code === 'P2002'
  }

  return false
}

export class BudgetService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getBudgetOrThrow(workspaceId: string, budgetId: string): Promise<Budget> {
    const budget = await this.prisma.budget.findFirst({
      where: {
        id: budgetId,
        workspaceId,
        deletedAt: null,
      },
    })

    if (!budget) {
      throw new HttpError(404, 'PRESUPUESTO_NO_ENCONTRADO', 'El presupuesto no existe')
    }

    return budget
  }

  private async assertExpenseCategory(
    workspaceId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
      },
    })

    if (!category) {
      throw new HttpError(
        404,
        'PRESUPUESTO_CATEGORIA_INVALIDA',
        'La categoría indicada no existe',
      )
    }

    if (category.type !== 'EXPENSE') {
      throw new HttpError(
        400,
        'PRESUPUESTO_CATEGORIA_INVALIDA',
        'Solo se permiten categorías EXPENSE en presupuestos',
      )
    }
  }

  private async getSpentByCategoryForYearMonth(
    workspaceId: string,
    yearMonth: string,
    timezone: string,
  ): Promise<Map<string, number>> {
    const { fromUtc, toUtc } = resolveYearMonthRangeUtc(yearMonth, timezone)

    const spentGrouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      orderBy: [{ categoryId: 'asc' }],
      where: {
        workspaceId,
        deletedAt: null,
        type: 'EXPENSE',
        categoryId: {
          not: null,
        },
        occurredAt: {
          gte: fromUtc,
          lte: toUtc,
        },
      },
      _sum: {
        amount: true,
      },
    })

    const spentByCategory = new Map<string, number>()

    for (const row of spentGrouped) {
      if (!row.categoryId) {
        continue
      }

      spentByCategory.set(row.categoryId, row._sum?.amount ?? 0)
    }

    return spentByCategory
  }

  private mapBudgetView(budget: Budget, spentAmount: number): BudgetView {
    return {
      id: budget.id,
      workspaceId: budget.workspaceId,
      categoryId: budget.categoryId,
      yearMonth: budget.yearMonth,
      limitAmount: budget.limitAmount,
      notes: budget.notes,
      progress: calculateBudgetProgress(budget.limitAmount, spentAmount),
    }
  }

  async createBudget(
    scope: WorkspaceScope,
    userId: string,
    input: CreateBudgetInput,
  ): Promise<BudgetView> {
    assertPositiveAmount(input.limitAmount, 'limitAmount')
    await this.assertExpenseCategory(scope.workspaceId, input.categoryId)

    const yearMonth = resolveYearMonth(input.yearMonth, scope.timezone)

    try {
      const created = await this.prisma.budget.create({
        data: {
          workspaceId: scope.workspaceId,
          categoryId: input.categoryId,
          createdByUserId: userId,
          yearMonth,
          limitAmount: input.limitAmount,
          notes: input.notes?.trim(),
        },
      })

      const spentByCategory = await this.getSpentByCategoryForYearMonth(
        scope.workspaceId,
        yearMonth,
        scope.timezone,
      )

      return this.mapBudgetView(created, spentByCategory.get(created.categoryId) ?? 0)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HttpError(
          409,
          'PRESUPUESTO_DUPLICADO',
          'Ya existe presupuesto para esa categoría y mes',
        )
      }

      throw error
    }
  }

  async listBudgets(scope: WorkspaceScope, filters: ListBudgetsFilter): Promise<BudgetView[]> {
    const yearMonth = resolveYearMonth(filters.yearMonth, scope.timezone)

    const [budgets, spentByCategory] = await Promise.all([
      this.prisma.budget.findMany({
        where: {
          workspaceId: scope.workspaceId,
          yearMonth,
          deletedAt: null,
        },
        orderBy: [{ yearMonth: 'asc' }, { createdAt: 'asc' }],
      }),
      this.getSpentByCategoryForYearMonth(scope.workspaceId, yearMonth, scope.timezone),
    ])

    return budgets.map((budget) => {
      return this.mapBudgetView(budget, spentByCategory.get(budget.categoryId) ?? 0)
    })
  }

  async updateBudget(
    scope: WorkspaceScope,
    budgetId: string,
    input: UpdateBudgetInput,
  ): Promise<BudgetView> {
    const current = await this.getBudgetOrThrow(scope.workspaceId, budgetId)

    if (typeof input.limitAmount === 'number') {
      assertPositiveAmount(input.limitAmount, 'limitAmount')
    }

    const nextCategoryId = input.categoryId ?? current.categoryId
    const nextYearMonth = input.yearMonth
      ? resolveYearMonth(input.yearMonth, scope.timezone)
      : current.yearMonth

    await this.assertExpenseCategory(scope.workspaceId, nextCategoryId)

    try {
      const updated = await this.prisma.budget.update({
        where: {
          id: budgetId,
        },
        data: {
          categoryId: input.categoryId,
          yearMonth: input.yearMonth ? nextYearMonth : undefined,
          limitAmount: input.limitAmount,
          notes: input.notes === undefined ? undefined : input.notes?.trim() ?? null,
        },
      })

      const spentByCategory = await this.getSpentByCategoryForYearMonth(
        scope.workspaceId,
        nextYearMonth,
        scope.timezone,
      )

      return this.mapBudgetView(updated, spentByCategory.get(updated.categoryId) ?? 0)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HttpError(
          409,
          'PRESUPUESTO_DUPLICADO',
          'Ya existe presupuesto para esa categoría y mes',
        )
      }

      throw error
    }
  }

  async deleteBudget(scope: WorkspaceScope, budgetId: string): Promise<void> {
    const budget = await this.getBudgetOrThrow(scope.workspaceId, budgetId)

    await this.prisma.budget.update({
      where: {
        id: budget.id,
      },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  async getSummary(scope: WorkspaceScope, filters: ListBudgetsFilter): Promise<BudgetSummary> {
    const yearMonth = resolveYearMonth(filters.yearMonth, scope.timezone)
    const budgets = await this.listBudgets(scope, { yearMonth })

    const summary = {
      yearMonth,
      totalBudgeted: 0,
      totalSpent: 0,
      totalRemaining: 0,
      warningCount: 0,
      exceededCount: 0,
    }

    for (const budget of budgets) {
      summary.totalBudgeted += budget.limitAmount
      summary.totalSpent += budget.progress.spentAmount
      summary.totalRemaining += budget.progress.remainingAmount

      if (budget.progress.alertLevel === 'WARNING') {
        summary.warningCount += 1
      }

      if (budget.progress.alertLevel === 'EXCEEDED') {
        summary.exceededCount += 1
      }
    }

    return summary
  }
}
