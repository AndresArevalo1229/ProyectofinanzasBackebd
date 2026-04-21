import type { PrismaClient, WorkspaceRole } from '@prisma/client'

import { HttpError } from '../errors/http-error.js'

export interface WorkspaceAccessContext {
  workspaceId: string
  role: WorkspaceRole
  timezone: string
  baseCurrency: string
}

export const assertWorkspaceAccess = async (
  prisma: PrismaClient,
  params: {
    workspaceId: string
    userId: string
    ownerOnly?: boolean
  },
): Promise<WorkspaceAccessContext> => {
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      deletedAt: null,
      workspace: {
        deletedAt: null,
      },
    },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          timezone: true,
          baseCurrency: true,
        },
      },
    },
  })

  if (!membership) {
    throw new HttpError(403, 'WORKSPACE_SIN_ACCESO', 'No tienes acceso al workspace indicado')
  }

  if (params.ownerOnly && membership.role !== 'OWNER') {
    throw new HttpError(403, 'PERMISO_DENEGADO', 'Solo el owner puede realizar esta acción')
  }

  return {
    workspaceId: membership.workspace.id,
    role: membership.role,
    timezone: membership.workspace.timezone,
    baseCurrency: membership.workspace.baseCurrency,
  }
}
