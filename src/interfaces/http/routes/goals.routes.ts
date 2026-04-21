import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { GoalService } from '../../../application/goals/goal.service.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getAuthUser, getWorkspaceContext } from '../utils/request-context.js'
import { validateWithSchema } from '../utils/validation.js'

interface GoalsRoutesDependencies {
  goalService: GoalService
  requireAuth: (request: FastifyRequest) => Promise<void>
  requireWorkspace: (request: FastifyRequest) => Promise<void>
}

const periodSchema = z.enum(['day', 'week', 'month', 'year', 'custom'])
const goalStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'CANCELED'])

const createGoalSchema = z.object({
  name: z.string().min(2),
  targetAmount: z.number().int().positive(),
  targetDate: z.string().datetime().optional(),
  notes: z.string().max(5000).optional(),
})

const updateGoalSchema = z.object({
  name: z.string().min(2).optional(),
  targetAmount: z.number().int().positive().optional(),
  targetDate: z.string().datetime().nullable().optional(),
  status: goalStatusSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
})

const createContributionSchema = z.object({
  amount: z.number().int().positive(),
  contributedAt: z.string().datetime(),
  notes: z.string().max(5000).optional(),
  transactionId: z.string().min(10).optional(),
})

const contributionsQuerySchema = z.object({
  period: periodSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  anchorDate: z.string().datetime().optional(),
})

export const registerGoalsRoutes = (
  app: FastifyInstance,
  dependencies: GoalsRoutesDependencies,
): void => {
  const preHandlers = [dependencies.requireAuth, dependencies.requireWorkspace]

  app.post(
    '/goals',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Crear meta',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(createGoalSchema, request.body)

      const goal = await dependencies.goalService.createGoal(workspace, authUser.id, input)

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Meta creada',
          datos: goal,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/goals',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Listar metas',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const goals = await dependencies.goalService.listGoals(workspace)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Metas obtenidas',
          datos: goals,
          requestId: request.id,
        }),
      )
    },
  )

  app.patch(
    '/goals/:goalId',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Actualizar meta',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { goalId: string }
      const input = validateWithSchema(updateGoalSchema, request.body)

      const goal = await dependencies.goalService.updateGoal(workspace, params.goalId, input)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Meta actualizada',
          datos: goal,
          requestId: request.id,
        }),
      )
    },
  )

  app.delete(
    '/goals/:goalId',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Eliminar meta (soft delete)',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { goalId: string }

      await dependencies.goalService.deleteGoal(workspace, params.goalId)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Meta eliminada',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/goals/:goalId/contributions',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Registrar aportación a meta',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const params = request.params as { goalId: string }
      const input = validateWithSchema(createContributionSchema, request.body)

      const contribution = await dependencies.goalService.createContribution(
        workspace,
        params.goalId,
        authUser.id,
        input,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Aportación creada',
          datos: contribution,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/goals/:goalId/contributions',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Listar aportaciones de una meta',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const params = request.params as { goalId: string }
      const filters = validateWithSchema(contributionsQuerySchema, request.query)

      const contributions = await dependencies.goalService.listContributions(
        workspace,
        params.goalId,
        filters,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Aportaciones obtenidas',
          datos: contributions,
          requestId: request.id,
        }),
      )
    },
  )
}
