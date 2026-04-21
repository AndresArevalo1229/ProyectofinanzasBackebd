import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { WorkspaceService } from '../../../application/workspaces/workspace.service.js'
import { HttpError } from '../errors/http-error.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getAuthUser, getWorkspaceContext } from '../utils/request-context.js'
import { validateWithSchema } from '../utils/validation.js'
import { assertWorkspaceAccess } from '../utils/workspace-access.js'

interface WorkspacesRoutesDependencies {
  workspaceService: WorkspaceService
  prisma: PrismaClient
  requireAuth: (request: FastifyRequest) => Promise<void>
}

const createWorkspaceSchema = z.object({
  name: z.string().min(2),
  baseCurrency: z.string().length(3).optional(),
  timezone: z.string().min(3).optional(),
})

const joinWorkspaceSchema = z.object({
  code: z.string().min(6),
})

const updateSettingsSchema = z.object({
  name: z.string().min(2).optional(),
  baseCurrency: z.string().length(3).optional(),
  timezone: z.string().min(3).optional(),
})

export const registerWorkspacesRoutes = (
  app: FastifyInstance,
  dependencies: WorkspacesRoutesDependencies,
): void => {
  app.post(
    '/workspaces',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Crear workspace',
      },
      preHandler: dependencies.requireAuth,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const input = validateWithSchema(createWorkspaceSchema, request.body)

      const workspace = await dependencies.workspaceService.createWorkspace(authUser.id, input)

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Workspace creado',
          datos: workspace,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/workspaces',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Listar workspaces del usuario',
      },
      preHandler: dependencies.requireAuth,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)

      const workspaces = await dependencies.workspaceService.listWorkspacesByUser(authUser.id)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Workspaces obtenidos',
          datos: workspaces,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/workspaces/join',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Unirse por código de invitación',
      },
      preHandler: dependencies.requireAuth,
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const input = validateWithSchema(joinWorkspaceSchema, request.body)

      const joined = await dependencies.workspaceService.joinWorkspaceByInvite(
        authUser.id,
        input.code,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Te uniste al workspace',
          datos: joined,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/workspaces/:workspaceId/invites',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Crear invitación de workspace',
      },
      preHandler: [
        dependencies.requireAuth,
        async (request) => {
          const authUser = getAuthUser(request)
          const workspaceId = (request.params as { workspaceId?: string }).workspaceId

          if (!workspaceId) {
            throw new HttpError(400, 'WORKSPACE_INVALIDO', 'workspaceId es requerido')
          }

          request.workspaceContext = await assertWorkspaceAccess(dependencies.prisma, {
            workspaceId,
            userId: authUser.id,
            ownerOnly: true,
          })
        },
      ],
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)

      const invite = await dependencies.workspaceService.createInvite(
        workspace.workspaceId,
        authUser.id,
      )

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Invitación creada',
          datos: invite,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/workspaces/:workspaceId/members',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Listar miembros del workspace',
      },
      preHandler: [
        dependencies.requireAuth,
        async (request) => {
          const authUser = getAuthUser(request)
          const workspaceId = (request.params as { workspaceId?: string }).workspaceId

          if (!workspaceId) {
            throw new HttpError(400, 'WORKSPACE_INVALIDO', 'workspaceId es requerido')
          }

          request.workspaceContext = await assertWorkspaceAccess(dependencies.prisma, {
            workspaceId,
            userId: authUser.id,
          })
        },
      ],
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const members = await dependencies.workspaceService.listMembers(workspace.workspaceId)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Miembros obtenidos',
          datos: members,
          requestId: request.id,
        }),
      )
    },
  )

  app.delete(
    '/workspaces/:workspaceId/members/:userId',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Remover miembro del workspace',
      },
      preHandler: [
        dependencies.requireAuth,
        async (request) => {
          const authUser = getAuthUser(request)
          const workspaceId = (request.params as { workspaceId?: string }).workspaceId

          if (!workspaceId) {
            throw new HttpError(400, 'WORKSPACE_INVALIDO', 'workspaceId es requerido')
          }

          request.workspaceContext = await assertWorkspaceAccess(dependencies.prisma, {
            workspaceId,
            userId: authUser.id,
            ownerOnly: true,
          })
        },
      ],
    },
    async (request, reply) => {
      const authUser = getAuthUser(request)
      const workspace = getWorkspaceContext(request)
      const params = request.params as { userId: string }

      await dependencies.workspaceService.removeMember(
        workspace.workspaceId,
        params.userId,
        authUser.id,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Miembro removido',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.patch(
    '/workspaces/:workspaceId/settings',
    {
      schema: {
        tags: ['Workspaces'],
        summary: 'Actualizar configuración del workspace',
      },
      preHandler: [
        dependencies.requireAuth,
        async (request) => {
          const authUser = getAuthUser(request)
          const workspaceId = (request.params as { workspaceId?: string }).workspaceId

          if (!workspaceId) {
            throw new HttpError(400, 'WORKSPACE_INVALIDO', 'workspaceId es requerido')
          }

          request.workspaceContext = await assertWorkspaceAccess(dependencies.prisma, {
            workspaceId,
            userId: authUser.id,
            ownerOnly: true,
          })
        },
      ],
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const input = validateWithSchema(updateSettingsSchema, request.body)

      const updated = await dependencies.workspaceService.updateWorkspaceSettings(
        workspace.workspaceId,
        input,
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Configuración actualizada',
          datos: updated,
          requestId: request.id,
        }),
      )
    },
  )
}
