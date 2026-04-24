import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { ExpansionService } from '../../../application/expansion/expansion.service.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getAuthUser, getWorkspaceContext } from '../utils/request-context.js'
import { validateWithSchema } from '../utils/validation.js'

interface ExpansionRoutesDependencies {
  expansionService: ExpansionService
  requireAuth: (request: FastifyRequest) => Promise<void>
  requireWorkspace: (request: FastifyRequest) => Promise<void>
}

const periodSchema = z.enum(['day', 'week', 'month', 'year', 'custom'])
const shoppingPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])
const shoppingStatusSchema = z.enum(['PENDING', 'BOUGHT', 'CANCELED'])

const phase5StatusQuerySchema = z.object({})

const ticketsQuerySchema = z.object({
  period: periodSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  anchorDate: z.string().datetime().optional(),
  search: z.string().min(1).optional(),
})

const createTicketSchema = z.object({
  title: z.string().min(2).max(150),
  amount: z.number().int().positive(),
  purchasedAt: z.string().datetime(),
  merchant: z.string().max(150).optional(),
  category: z.string().max(80).optional(),
  currency: z.string().min(3).max(3).optional(),
  notes: z.string().max(5000).optional(),
  linkedTransactionId: z.string().min(10).optional(),
})

const shoppingItemsQuerySchema = z.object({
  status: shoppingStatusSchema.optional(),
  search: z.string().min(1).optional(),
})

const createShoppingItemSchema = z.object({
  name: z.string().min(2).max(120),
  quantity: z.number().int().positive(),
  unit: z.string().max(20).optional(),
  estimatedAmount: z.number().int().positive().optional(),
  priority: shoppingPrioritySchema.optional(),
  status: shoppingStatusSchema.optional(),
  notes: z.string().max(5000).optional(),
  linkedTransactionId: z.string().min(10).optional(),
})

const inventoryItemsQuerySchema = z.object({
  lowStockOnly: z.coerce.boolean().optional(),
  search: z.string().min(1).optional(),
})

const createInventoryItemSchema = z.object({
  name: z.string().min(2).max(120),
  stock: z.number().int().min(0),
  minStock: z.number().int().min(0),
  unit: z.string().max(20).optional(),
  location: z.string().max(120).optional(),
  reorderQty: z.number().int().min(0).optional(),
  notes: z.string().max(5000).optional(),
})

export const registerExpansionRoutes = (
  app: FastifyInstance,
  dependencies: ExpansionRoutesDependencies,
): void => {
  const preHandlers = [dependencies.requireAuth, dependencies.requireWorkspace]

  app.get(
    '/phase5/status',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Estado de módulos de expansión (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      validateWithSchema(phase5StatusQuerySchema, request.query)
      const workspace = getWorkspaceContext(request)
      const status = await dependencies.expansionService.getStatus(workspace)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Estado de expansión obtenido',
          datos: status,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/tickets',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Listar tickets/comprobantes (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const query = validateWithSchema(ticketsQuerySchema, request.query)
      const tickets = await dependencies.expansionService.listTickets(workspace, query)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Tickets obtenidos',
          datos: tickets,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/tickets',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Crear ticket/comprobante (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createTicketSchema, request.body)

      const ticket = await dependencies.expansionService.createTicket(
        workspace,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Ticket creado',
          datos: ticket,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/shopping-items',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Listar compras del día (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const query = validateWithSchema(shoppingItemsQuerySchema, request.query)
      const items = await dependencies.expansionService.listShoppingItems(workspace, query)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Compras obtenidas',
          datos: items,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/shopping-items',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Crear compra del día (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createShoppingItemSchema, request.body)

      const shoppingItem = await dependencies.expansionService.createShoppingItem(
        workspace,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Compra creada',
          datos: shoppingItem,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/inventory-items',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Listar inventario (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const query = validateWithSchema(inventoryItemsQuerySchema, request.query)
      const items = await dependencies.expansionService.listInventoryItems(workspace, query)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Inventario obtenido',
          datos: items,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/inventory-items',
    {
      schema: {
        tags: ['Expansion'],
        summary: 'Crear item de inventario (fase 5)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createInventoryItemSchema, request.body)

      const inventoryItem = await dependencies.expansionService.createInventoryItem(
        workspace,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Item de inventario creado',
          datos: inventoryItem,
          requestId: request.id,
        }),
      )
    },
  )
}
