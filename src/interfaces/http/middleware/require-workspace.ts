import type { PrismaClient } from '@prisma/client'
import type { FastifyRequest } from 'fastify'

import { getAuthUser } from '../utils/request-context.js'
import { HttpError } from '../errors/http-error.js'
import { assertWorkspaceAccess } from '../utils/workspace-access.js'

interface RequireWorkspaceDependencies {
  prisma: PrismaClient
}

interface RequireWorkspaceOptions {
  ownerOnly?: boolean
}

const resolveWorkspaceId = (request: FastifyRequest): string => {
  const headerValue = request.headers['x-workspace-id']

  if (!headerValue) {
    throw new HttpError(
      400,
      'WORKSPACE_NO_SELECCIONADO',
      'Debes enviar el header x-workspace-id',
    )
  }

  if (Array.isArray(headerValue)) {
    if (headerValue.length === 0 || !headerValue[0]) {
      throw new HttpError(400, 'WORKSPACE_NO_SELECCIONADO', 'x-workspace-id es inválido')
    }

    return headerValue[0]
  }

  return headerValue
}

export const requireWorkspace =
  (
    dependencies: RequireWorkspaceDependencies,
    options: RequireWorkspaceOptions = {},
  ) =>
  async (request: FastifyRequest): Promise<void> => {
    const authUser = getAuthUser(request)
    const workspaceId = resolveWorkspaceId(request)

    request.workspaceContext = await assertWorkspaceAccess(dependencies.prisma, {
      workspaceId,
      userId: authUser.id,
      ownerOnly: options.ownerOnly,
    })
  }
