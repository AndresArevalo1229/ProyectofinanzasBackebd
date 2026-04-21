import type { PrismaClient } from '@prisma/client'

import { dayjs } from '../shared/time/dayjs.js'
import { resolvePeriodRange, type Period } from '../shared/time/period-range.js'

interface WorkspaceScope {
  workspaceId: string
  timezone: string
}

interface DateRangeFilter {
  period?: Period
  from?: string
  to?: string
  anchorDate?: string
}

interface AccountBalance {
  id: string
  name: string
  type: string
  balance: number
}

const buildDateRange = (scope: WorkspaceScope, filters: DateRangeFilter) => {
  return resolvePeriodRange({
    timezone: scope.timezone,
    period: filters.period,
    from: filters.from,
    to: filters.to,
    anchorDate: filters.anchorDate,
  })
}

export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getAccountBalances(workspaceId: string): Promise<AccountBalance[]> {
    const [accounts, txAggregates, transferInAggregates, transferOutAggregates] =
      await this.prisma.$transaction([
        this.prisma.account.findMany({
          where: {
            workspaceId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            type: true,
            initialBalance: true,
          },
        }),
        this.prisma.transaction.groupBy({
          by: ['accountId', 'type'],
          orderBy: [{ accountId: 'asc' }, { type: 'asc' }],
          where: {
            workspaceId,
            deletedAt: null,
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.accountTransfer.groupBy({
          by: ['toAccountId'],
          orderBy: [{ toAccountId: 'asc' }],
          where: {
            workspaceId,
            deletedAt: null,
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.accountTransfer.groupBy({
          by: ['fromAccountId'],
          orderBy: [{ fromAccountId: 'asc' }],
          where: {
            workspaceId,
            deletedAt: null,
          },
          _sum: {
            amount: true,
          },
        }),
      ])

    const incomeByAccount = new Map<string, number>()
    const expenseByAccount = new Map<string, number>()

    for (const item of txAggregates) {
      const amount = item._sum?.amount ?? 0

      if (item.type === 'INCOME') {
        incomeByAccount.set(item.accountId, amount)
      }

      if (item.type === 'EXPENSE') {
        expenseByAccount.set(item.accountId, amount)
      }
    }

    const transferInByAccount = new Map<string, number>()
    const transferOutByAccount = new Map<string, number>()

    for (const item of transferInAggregates) {
      transferInByAccount.set(item.toAccountId, item._sum?.amount ?? 0)
    }

    for (const item of transferOutAggregates) {
      transferOutByAccount.set(item.fromAccountId, item._sum?.amount ?? 0)
    }

    return accounts.map((account) => {
      const balance =
        account.initialBalance +
        (incomeByAccount.get(account.id) ?? 0) -
        (expenseByAccount.get(account.id) ?? 0) +
        (transferInByAccount.get(account.id) ?? 0) -
        (transferOutByAccount.get(account.id) ?? 0)

      return {
        id: account.id,
        name: account.name,
        type: account.type,
        balance,
      }
    })
  }

  async getDashboardSummary(scope: WorkspaceScope, filters: DateRangeFilter) {
    const { fromUtc, toUtc } = buildDateRange(scope, filters)

    const [income, expense, accountBalances] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          workspaceId: scope.workspaceId,
          deletedAt: null,
          type: 'INCOME',
          occurredAt: {
            gte: fromUtc,
            lte: toUtc,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.transaction.aggregate({
        where: {
          workspaceId: scope.workspaceId,
          deletedAt: null,
          type: 'EXPENSE',
          occurredAt: {
            gte: fromUtc,
            lte: toUtc,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.getAccountBalances(scope.workspaceId),
    ])

    const ingresos = income._sum.amount ?? 0
    const egresos = expense._sum.amount ?? 0
    const ahorroNeto = ingresos - egresos
    const saldoNeto = accountBalances.reduce(
      (sum: number, account: AccountBalance) => sum + account.balance,
      0,
    )

    const topAccounts = [...accountBalances]
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3)

    return {
      periodo: {
        from: fromUtc,
        to: toUtc,
      },
      saldoNeto,
      ingresos,
      egresos,
      ahorroNeto,
      topAccounts,
    }
  }

  async getByCategory(scope: WorkspaceScope, filters: DateRangeFilter) {
    const { fromUtc, toUtc } = buildDateRange(scope, filters)

    const [grouped, categories] = await this.prisma.$transaction([
      this.prisma.transaction.groupBy({
        by: ['categoryId', 'type'],
        orderBy: [{ categoryId: 'asc' }, { type: 'asc' }],
        where: {
          workspaceId: scope.workspaceId,
          deletedAt: null,
          occurredAt: {
            gte: fromUtc,
            lte: toUtc,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.category.findMany({
        where: {
          workspaceId: scope.workspaceId,
        },
        select: {
          id: true,
          name: true,
          type: true,
        },
      }),
    ])

    const categoriesById = new Map(categories.map((category) => [category.id, category]))

    return grouped.map((row) => {
      const category = row.categoryId ? categoriesById.get(row.categoryId) : null

      return {
        categoryId: row.categoryId,
        categoryName: category?.name ?? 'Sin categoría',
        type: row.type,
        total: row._sum?.amount ?? 0,
      }
    })
  }

  async getCashflow(scope: WorkspaceScope, filters: DateRangeFilter) {
    const { fromUtc, toUtc } = buildDateRange(scope, filters)

    const transactions = await this.prisma.transaction.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        occurredAt: {
          gte: fromUtc,
          lte: toUtc,
        },
      },
      select: {
        amount: true,
        type: true,
        occurredAt: true,
      },
      orderBy: {
        occurredAt: 'asc',
      },
    })

    const byDay = new Map<
      string,
      {
        fecha: string
        ingresos: number
        egresos: number
        neto: number
      }
    >()

    for (const transaction of transactions) {
      const dateKey = dayjs(transaction.occurredAt)
        .tz(scope.timezone)
        .format('YYYY-MM-DD')

      const current = byDay.get(dateKey) ?? {
        fecha: dateKey,
        ingresos: 0,
        egresos: 0,
        neto: 0,
      }

      if (transaction.type === 'INCOME') {
        current.ingresos += transaction.amount
      }

      if (transaction.type === 'EXPENSE') {
        current.egresos += transaction.amount
      }

      current.neto = current.ingresos - current.egresos
      byDay.set(dateKey, current)
    }

    return {
      periodo: {
        from: fromUtc,
        to: toUtc,
      },
      serie: [...byDay.values()],
    }
  }
}
