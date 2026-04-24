import type {
  PrismaClient,
  ShoppingPriority,
  ShoppingItemStatus,
} from '@prisma/client'

import { resolvePeriodRange, type Period } from '../shared/time/period-range.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

interface WorkspaceScope {
  workspaceId: string
  timezone: string
  baseCurrency: string
}

interface ListTicketsFilters {
  period?: Period
  from?: string
  to?: string
  anchorDate?: string
  search?: string
}

interface CreateTicketInput {
  title: string
  amount: number
  purchasedAt: string
  merchant?: string
  category?: string
  currency?: string
  notes?: string
  linkedTransactionId?: string
}

interface ListShoppingItemsFilters {
  status?: ShoppingItemStatus
  search?: string
}

interface CreateShoppingItemInput {
  name: string
  quantity: number
  unit?: string
  estimatedAmount?: number
  priority?: ShoppingPriority
  status?: ShoppingItemStatus
  notes?: string
  linkedTransactionId?: string
}

interface ListInventoryItemsFilters {
  lowStockOnly?: boolean
  search?: string
}

interface CreateInventoryItemInput {
  name: string
  stock: number
  minStock: number
  unit?: string
  location?: string
  reorderQty?: number
  notes?: string
}

const assertPositiveInt = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'SOLICITUD_INVALIDA', `${fieldName} debe ser entero positivo`)
  }
}

const assertNonNegativeInt = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'SOLICITUD_INVALIDA', `${fieldName} debe ser entero mayor o igual a 0`)
  }
}

const parseIsoDate = (raw: string, fieldName: string): Date => {
  const parsed = new Date(raw)

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'FECHA_INVALIDA', `${fieldName} no tiene un formato válido`)
  }

  return parsed
}

const normalizeSearch = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed
}

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export class ExpansionService {
  constructor(private readonly prisma: PrismaClient) {}

  private async validateLinkedTransaction(
    scope: WorkspaceScope,
    linkedTransactionId: string | undefined,
  ): Promise<string | null> {
    if (!linkedTransactionId) {
      return null
    }

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: linkedTransactionId,
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
        'El movimiento vinculado no existe en el workspace activo',
      )
    }

    return transaction.id
  }

  async getStatus(scope: WorkspaceScope) {
    const [ticketsCount, shoppingCount, inventoryCount] = await this.prisma.$transaction([
      this.prisma.ticket.count({
        where: {
          workspaceId: scope.workspaceId,
          deletedAt: null,
        },
      }),
      this.prisma.shoppingItem.count({
        where: {
          workspaceId: scope.workspaceId,
          deletedAt: null,
        },
      }),
      this.prisma.inventoryItem.count({
        where: {
          workspaceId: scope.workspaceId,
          deletedAt: null,
        },
      }),
    ])

    return {
      modules: [
        {
          key: 'tickets',
          label: 'Tickets/comprobantes',
          status: 'READY' as const,
          count: ticketsCount,
        },
        {
          key: 'shopping',
          label: 'Compras del día',
          status: 'READY' as const,
          count: shoppingCount,
        },
        {
          key: 'inventory',
          label: 'Inventario',
          status: 'READY' as const,
          count: inventoryCount,
        },
      ],
    }
  }

  async createTicket(
    scope: WorkspaceScope,
    userId: string,
    input: CreateTicketInput,
  ) {
    assertPositiveInt(input.amount, 'amount')

    const purchasedAt = parseIsoDate(input.purchasedAt, 'purchasedAt')
    const linkedTransactionId = await this.validateLinkedTransaction(scope, input.linkedTransactionId)

    const currency = normalizeOptionalString(input.currency)?.toUpperCase()
    if (currency && currency.length !== 3) {
      throw new HttpError(400, 'SOLICITUD_INVALIDA', 'currency debe tener exactamente 3 caracteres')
    }

    return this.prisma.ticket.create({
      data: {
        workspaceId: scope.workspaceId,
        createdByUserId: userId,
        linkedTransactionId,
        title: input.title.trim(),
        amount: input.amount,
        merchant: normalizeOptionalString(input.merchant),
        category: normalizeOptionalString(input.category),
        currency: currency ?? scope.baseCurrency,
        purchasedAt,
        notes: normalizeOptionalString(input.notes),
      },
    })
  }

  async listTickets(scope: WorkspaceScope, filters: ListTicketsFilters) {
    const range = resolvePeriodRange({
      timezone: scope.timezone,
      period: filters.period,
      from: filters.from,
      to: filters.to,
      anchorDate: filters.anchorDate,
    })

    const search = normalizeSearch(filters.search)

    return this.prisma.ticket.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        purchasedAt: {
          gte: range.fromUtc,
          lte: range.toUtc,
        },
        OR: search
          ? [
              {
                title: {
                  contains: search,
                },
              },
              {
                merchant: {
                  contains: search,
                },
              },
              {
                category: {
                  contains: search,
                },
              },
            ]
          : undefined,
      },
      orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
    })
  }

  async createShoppingItem(
    scope: WorkspaceScope,
    userId: string,
    input: CreateShoppingItemInput,
  ) {
    assertPositiveInt(input.quantity, 'quantity')

    if (input.estimatedAmount !== undefined) {
      assertPositiveInt(input.estimatedAmount, 'estimatedAmount')
    }

    const linkedTransactionId = await this.validateLinkedTransaction(scope, input.linkedTransactionId)

    return this.prisma.shoppingItem.create({
      data: {
        workspaceId: scope.workspaceId,
        createdByUserId: userId,
        linkedTransactionId,
        name: input.name.trim(),
        quantity: input.quantity,
        unit: normalizeOptionalString(input.unit),
        estimatedAmount: input.estimatedAmount,
        priority: input.priority ?? 'MEDIUM',
        status: input.status ?? 'PENDING',
        notes: normalizeOptionalString(input.notes),
      },
    })
  }

  async listShoppingItems(scope: WorkspaceScope, filters: ListShoppingItemsFilters) {
    const search = normalizeSearch(filters.search)

    return this.prisma.shoppingItem.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        status: filters.status,
        OR: search
          ? [
              {
                name: {
                  contains: search,
                },
              },
              {
                notes: {
                  contains: search,
                },
              },
            ]
          : undefined,
      },
      orderBy: [{ createdAt: 'desc' }],
    })
  }

  async createInventoryItem(
    scope: WorkspaceScope,
    userId: string,
    input: CreateInventoryItemInput,
  ) {
    assertNonNegativeInt(input.stock, 'stock')
    assertNonNegativeInt(input.minStock, 'minStock')

    if (input.reorderQty !== undefined) {
      assertNonNegativeInt(input.reorderQty, 'reorderQty')
    }

    return this.prisma.inventoryItem.create({
      data: {
        workspaceId: scope.workspaceId,
        createdByUserId: userId,
        name: input.name.trim(),
        stock: input.stock,
        minStock: input.minStock,
        unit: normalizeOptionalString(input.unit),
        location: normalizeOptionalString(input.location),
        reorderQty: input.reorderQty,
        notes: normalizeOptionalString(input.notes),
      },
    })
  }

  async listInventoryItems(scope: WorkspaceScope, filters: ListInventoryItemsFilters) {
    const search = normalizeSearch(filters.search)

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        OR: search
          ? [
              {
                name: {
                  contains: search,
                },
              },
              {
                location: {
                  contains: search,
                },
              },
              {
                notes: {
                  contains: search,
                },
              },
            ]
          : undefined,
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    const withLowStockFlag = items.map((item) => ({
      ...item,
      isLowStock: item.stock <= item.minStock,
    }))

    if (!filters.lowStockOnly) {
      return withLowStockFlag
    }

    return withLowStockFlag.filter((item) => item.isLowStock)
  }
}
