import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { FinanceService } from '../../../application/finance/finance.service.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getAuthUser, getWorkspaceContext } from '../utils/request-context.js'
import { validateWithSchema } from '../utils/validation.js'

interface FinanceRoutesDependencies {
  financeService: FinanceService
  requireAuth: (request: FastifyRequest) => Promise<void>
  requireWorkspace: (request: FastifyRequest) => Promise<void>
}

const accountTypeSchema = z.enum(['CASH', 'BANK', 'CARD', 'OTHER'])
const transactionTypeSchema = z.enum(['INCOME', 'EXPENSE'])
const periodSchema = z.enum(['day', 'week', 'month', 'year', 'custom'])

const createAccountSchema = z.object({
  name: z.string().min(2),
  type: accountTypeSchema,
  initialBalance: z.number().int().optional(),
})

const updateAccountSchema = z.object({
  name: z.string().min(2).optional(),
  type: accountTypeSchema.optional(),
  isArchived: z.boolean().optional(),
})

const createCategorySchema = z.object({
  name: z.string().min(2),
  type: transactionTypeSchema,
  color: z.string().min(3).max(30).optional(),
  icon: z.string().min(2).max(50).optional(),
})

const updateCategorySchema = z.object({
  name: z.string().min(2).optional(),
  type: transactionTypeSchema.optional(),
  color: z.string().min(3).max(30).optional(),
  icon: z.string().min(2).max(50).optional(),
})

const createTransactionSchema = z.object({
  accountId: z.string().min(10),
  categoryId: z.string().min(10).optional(),
  type: transactionTypeSchema,
  amount: z.number().int().positive(),
  description: z.string().max(250).optional(),
  notes: z.string().max(5000).optional(),
  occurredAt: z.string().datetime(),
  tags: z.array(z.string().min(1)).max(12).optional(),
})

const updateTransactionSchema = z.object({
  accountId: z.string().min(10).optional(),
  categoryId: z.string().min(10).nullable().optional(),
  type: transactionTypeSchema.optional(),
  amount: z.number().int().positive().optional(),
  description: z.string().max(250).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  tags: z.array(z.string().min(1)).max(12).optional(),
})

const transactionsQuerySchema = z.object({
  period: periodSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  anchorDate: z.string().datetime().optional(),
  type: transactionTypeSchema.optional(),
  accountId: z.string().min(10).optional(),
  categoryId: z.string().min(10).optional(),
  tag: z.string().min(1).optional(),
  createdByUserId: z.string().min(10).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
})

const createTransferSchema = z.object({
  fromAccountId: z.string().min(10),
  toAccountId: z.string().min(10),
  amount: z.number().int().positive(),
  description: z.string().max(250).optional(),
  transferredAt: z.string().datetime(),
})

const transfersQuerySchema = z.object({
  period: periodSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  anchorDate: z.string().datetime().optional(),
  accountId: z.string().min(10).optional(),
})

export const registerFinanceRoutes = (
  app: FastifyInstance,
  dependencies: FinanceRoutesDependencies,
): void => {
  const preHandlers = [dependencies.requireAuth, dependencies.requireWorkspace]

  app.post(
    '/accounts',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Crear cuenta',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createAccountSchema, request.body)

      const account = await dependencies.financeService.createAccount(
        workspace,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Cuenta creada',
          datos: account,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/accounts',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Listar cuentas',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const accounts = await dependencies.financeService.listAccounts(workspace)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Cuentas obtenidas',
          datos: accounts,
          requestId: request.id,
        }),
      )
    },
  )

  app.patch(
    '/accounts/:accountId',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Actualizar cuenta',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { accountId: string }
      const input = validateWithSchema(updateAccountSchema, request.body)

      const account = await dependencies.financeService.updateAccount(
        workspace,
        params.accountId,
        input,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Cuenta actualizada',
          datos: account,
          requestId: request.id,
        }),
      )
    },
  )

  app.delete(
    '/accounts/:accountId',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Eliminar cuenta (soft delete)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { accountId: string }

      await dependencies.financeService.deleteAccount(workspace, params.accountId)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Cuenta eliminada',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/categories',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Crear categoría',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createCategorySchema, request.body)

      const category = await dependencies.financeService.createCategory(
        workspace,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Categoría creada',
          datos: category,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/categories',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Listar categorías',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const categories = await dependencies.financeService.listCategories(workspace)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Categorías obtenidas',
          datos: categories,
          requestId: request.id,
        }),
      )
    },
  )

  app.patch(
    '/categories/:categoryId',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Actualizar categoría',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { categoryId: string }
      const input = validateWithSchema(updateCategorySchema, request.body)

      const category = await dependencies.financeService.updateCategory(
        workspace,
        params.categoryId,
        input,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Categoría actualizada',
          datos: category,
          requestId: request.id,
        }),
      )
    },
  )

  app.delete(
    '/categories/:categoryId',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Eliminar categoría (soft delete)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { categoryId: string }

      await dependencies.financeService.deleteCategory(workspace, params.categoryId)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Categoría eliminada',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/transactions',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Crear movimiento',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createTransactionSchema, request.body)

      const transaction = await dependencies.financeService.createTransaction(
        workspace,
        authUser.id,
        input,
      )

      const metaAdicional =
        transaction.alertasPresupuesto.length > 0
          ? {
              alertasPresupuesto: transaction.alertasPresupuesto,
            }
          : undefined

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Movimiento creado',
          datos: transaction.transaction,
          requestId: request.id,
          metaAdicional,
        }),
      )
    },
  )

  app.get(
    '/transactions',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Listar movimientos',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const filters = validateWithSchema(transactionsQuerySchema, request.query)

      const transactions = await dependencies.financeService.listTransactions(
        workspace,
        filters,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Movimientos obtenidos',
          datos: transactions,
          requestId: request.id,
        }),
      )
    },
  )

  app.patch(
    '/transactions/:transactionId',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Actualizar movimiento',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { transactionId: string }
      const input = validateWithSchema(updateTransactionSchema, request.body)

      const transaction = await dependencies.financeService.updateTransaction(
        workspace,
        params.transactionId,
        input,
      )

      const metaAdicional =
        transaction.alertasPresupuesto.length > 0
          ? {
              alertasPresupuesto: transaction.alertasPresupuesto,
            }
          : undefined

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Movimiento actualizado',
          datos: transaction.transaction,
          requestId: request.id,
          metaAdicional,
        }),
      )
    },
  )

  app.delete(
    '/transactions/:transactionId',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Eliminar movimiento (soft delete)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { transactionId: string }

      await dependencies.financeService.deleteTransaction(workspace, params.transactionId)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Movimiento eliminado',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/transfers',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Crear transferencia entre cuentas',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createTransferSchema, request.body)

      const transfer = await dependencies.financeService.createTransfer(
        workspace,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Transferencia creada',
          datos: transfer,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/transfers',
    {
      schema: {
        tags: ['Finance'],
        summary: 'Listar transferencias',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const filters = validateWithSchema(transfersQuerySchema, request.query)

      const transfers = await dependencies.financeService.listTransfers(workspace, filters)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Transferencias obtenidas',
          datos: transfers,
          requestId: request.id,
        }),
      )
    },
  )
}
