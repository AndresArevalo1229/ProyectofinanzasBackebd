import type { GoalStatus, PrismaClient } from '@prisma/client'

import { resolvePeriodRange, type Period } from '../shared/time/period-range.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

interface WorkspaceScope {
  workspaceId: string
  timezone: string
}

interface CreateGoalInput {
  name: string
  targetAmount: number
  targetDate?: string
  notes?: string
}

interface UpdateGoalInput {
  name?: string
  targetAmount?: number
  targetDate?: string | null
  status?: GoalStatus
  notes?: string | null
}

interface CreateGoalContributionInput {
  amount: number
  contributedAt: string
  notes?: string
  transactionId?: string
}

interface ListGoalContributionsFilter {
  period?: Period
  from?: string
  to?: string
  anchorDate?: string
}

const parseDate = (value: string, fieldName: string): Date => {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'FECHA_INVALIDA', `${fieldName} tiene un formato inválido`)
  }

  return parsed
}

const assertPositive = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'MONTO_INVALIDO', `${fieldName} debe ser entero positivo`)
  }
}

export class GoalService {
  constructor(private readonly prisma: PrismaClient) {}

  async createGoal(scope: WorkspaceScope, userId: string, input: CreateGoalInput) {
    assertPositive(input.targetAmount, 'targetAmount')

    return this.prisma.goal.create({
      data: {
        workspaceId: scope.workspaceId,
        createdByUserId: userId,
        name: input.name.trim(),
        targetAmount: input.targetAmount,
        targetDate: input.targetDate ? parseDate(input.targetDate, 'targetDate') : undefined,
        notes: input.notes?.trim(),
      },
    })
  }

  async listGoals(scope: WorkspaceScope) {
    const goals = await this.prisma.goal.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      include: {
        contributions: {
          where: {
            deletedAt: null,
          },
          select: {
            amount: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    return goals.map((goal) => {
      const currentAmount = goal.contributions.reduce((sum, item) => sum + item.amount, 0)

      return {
        id: goal.id,
        workspaceId: goal.workspaceId,
        createdByUserId: goal.createdByUserId,
        name: goal.name,
        targetAmount: goal.targetAmount,
        currentAmount,
        progressPercent:
          goal.targetAmount > 0
            ? Math.min(100, Number(((currentAmount / goal.targetAmount) * 100).toFixed(2)))
            : 0,
        status: goal.status,
        targetDate: goal.targetDate,
        notes: goal.notes,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
      }
    })
  }

  async updateGoal(scope: WorkspaceScope, goalId: string, input: UpdateGoalInput) {
    const existing = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
    })

    if (!existing) {
      throw new HttpError(404, 'META_NO_ENCONTRADA', 'La meta no existe')
    }

    if (typeof input.targetAmount === 'number') {
      assertPositive(input.targetAmount, 'targetAmount')
    }

    return this.prisma.goal.update({
      where: {
        id: goalId,
      },
      data: {
        name: input.name?.trim(),
        targetAmount: input.targetAmount,
        targetDate:
          input.targetDate === undefined
            ? undefined
            : input.targetDate === null
              ? null
              : parseDate(input.targetDate, 'targetDate'),
        status: input.status,
        notes: input.notes === undefined ? undefined : input.notes?.trim() ?? null,
      },
    })
  }

  async deleteGoal(scope: WorkspaceScope, goalId: string): Promise<void> {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    })

    if (!goal) {
      throw new HttpError(404, 'META_NO_ENCONTRADA', 'La meta no existe')
    }

    await this.prisma.goal.update({
      where: {
        id: goalId,
      },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  async createContribution(
    scope: WorkspaceScope,
    goalId: string,
    userId: string,
    input: CreateGoalContributionInput,
  ) {
    assertPositive(input.amount, 'amount')

    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    })

    if (!goal) {
      throw new HttpError(404, 'META_NO_ENCONTRADA', 'La meta no existe')
    }

    if (input.transactionId) {
      const transaction = await this.prisma.transaction.findFirst({
        where: {
          id: input.transactionId,
          workspaceId: scope.workspaceId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      })

      if (!transaction) {
        throw new HttpError(
          404,
          'MOVIMIENTO_NO_ENCONTRADO',
          'El movimiento relacionado no existe',
        )
      }
    }

    return this.prisma.goalContribution.create({
      data: {
        workspaceId: scope.workspaceId,
        goalId,
        createdByUserId: userId,
        amount: input.amount,
        contributedAt: parseDate(input.contributedAt, 'contributedAt'),
        notes: input.notes?.trim(),
        transactionId: input.transactionId,
      },
      include: {
        transaction: true,
      },
    })
  }

  async listContributions(
    scope: WorkspaceScope,
    goalId: string,
    filters: ListGoalContributionsFilter,
  ) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        workspaceId: scope.workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    })

    if (!goal) {
      throw new HttpError(404, 'META_NO_ENCONTRADA', 'La meta no existe')
    }

    const { fromUtc, toUtc } = resolvePeriodRange({
      timezone: scope.timezone,
      period: filters.period,
      from: filters.from,
      to: filters.to,
      anchorDate: filters.anchorDate,
    })

    return this.prisma.goalContribution.findMany({
      where: {
        workspaceId: scope.workspaceId,
        goalId,
        deletedAt: null,
        contributedAt: {
          gte: fromUtc,
          lte: toUtc,
        },
      },
      include: {
        createdByUser: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
        transaction: {
          select: {
            id: true,
            amount: true,
            type: true,
            occurredAt: true,
          },
        },
      },
      orderBy: [{ contributedAt: 'desc' }, { createdAt: 'desc' }],
    })
  }
}
