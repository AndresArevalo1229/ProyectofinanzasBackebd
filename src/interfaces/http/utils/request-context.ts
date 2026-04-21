import type { FastifyRequest } from 'fastify'

import { HttpError } from '../errors/http-error.js'

export const getAuthUser = (request: FastifyRequest) => {
  if (!request.authUser) {
    throw new HttpError(401, 'NO_AUTENTICADO', 'Debes iniciar sesión para continuar')
  }

  return request.authUser
}

export const getWorkspaceContext = (request: FastifyRequest) => {
  if (!request.workspaceContext) {
    throw new HttpError(
      400,
      'WORKSPACE_NO_SELECCIONADO',
      'Debes enviar el header x-workspace-id',
    )
  }

  return request.workspaceContext
}
