import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { BudgetService } from '../../../application/budgets/budget.service.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getAuthUser, getWorkspaceContext } from '../utils/request-context.js'
import { validateWithSchema } from '../utils/validation.js'

interface BudgetsRoutesDependencies {
  budgetService: BudgetService
  requireAuth: (request: FastifyRequest) => Promise<void>
  requireWorkspace: (request: FastifyRequest) => Promise<void>
  requireWorkspaceOwner: (request: FastifyRequest) => Promise<void>
}

const yearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

const createBudgetSchema = z.object({
  categoryId: z.string().min(10),
  yearMonth: yearMonthSchema.optional(),
  limitAmount: z.number().int().positive(),
  notes: z.string().max(5000).optional(),
})

const updateBudgetSchema = z.object({
  categoryId: z.string().min(10).optional(),
  yearMonth: yearMonthSchema.optional(),
  limitAmount: z.number().int().positive().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

const budgetsQuerySchema = z.object({
  yearMonth: yearMonthSchema.optional(),
})

export const registerBudgetsRoutes = (
  app: FastifyInstance,
  dependencies: BudgetsRoutesDependencies,
): void => {
  const readPreHandlers = [dependencies.requireAuth, dependencies.requireWorkspace]
  const writePreHandlers = [dependencies.requireAuth, dependencies.requireWorkspaceOwner]

  app.post(
    '/budgets',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Crear presupuesto por categoría/mes',
      },
      preHandler: writePreHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createBudgetSchema, request.body)

      const budget = await dependencies.budgetService.createBudget(workspace, authUser.id, input)

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Presupuesto creado',
          datos: budget,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/budgets',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Listar presupuestos por mes',
      },
      preHandler: readPreHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const query = validateWithSchema(budgetsQuerySchema, request.query)
      const budgets = await dependencies.budgetService.listBudgets(workspace, query)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Presupuestos obtenidos',
          datos: budgets,
          requestId: request.id,
        }),
      )
    },
  )

  app.patch(
    '/budgets/:budgetId',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Actualizar presupuesto',
      },
      preHandler: writePreHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { budgetId: string }
      const input = validateWithSchema(updateBudgetSchema, request.body)

      const budget = await dependencies.budgetService.updateBudget(
        workspace,
        params.budgetId,
        input,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Presupuesto actualizado',
          datos: budget,
          requestId: request.id,
        }),
      )
    },
  )

  app.delete(
    '/budgets/:budgetId',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Eliminar presupuesto (soft delete)',
      },
      preHandler: writePreHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { budgetId: string }

      await dependencies.budgetService.deleteBudget(workspace, params.budgetId)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Presupuesto eliminado',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/budgets/summary',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Resumen de presupuestos por mes',
      },
      preHandler: readPreHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const query = validateWithSchema(budgetsQuerySchema, request.query)
      const summary = await dependencies.budgetService.getSummary(workspace, query)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Resumen de presupuestos obtenido',
          datos: summary,
          requestId: request.id,
        }),
      )
    },
  )
}
