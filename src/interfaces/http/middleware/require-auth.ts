import type { PrismaClient } from '@prisma/client'
import type { FastifyRequest } from 'fastify'

import type { AppConfig } from '../../../infrastructure/config/env.js'
import { verifyAccessToken } from '../../../infrastructure/security/token.js'
import { HttpError } from '../errors/http-error.js'

interface RequireAuthDependencies {
  prisma: PrismaClient
  config: Pick<AppConfig, 'auth'>
}

const getBearerToken = (request: FastifyRequest): string => {
  const authorization = request.headers.authorization

  if (!authorization) {
    throw new HttpError(401, 'TOKEN_REQUERIDO', 'Debes enviar un token Bearer')
  }

  const [scheme, token] = authorization.split(' ')

  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'TOKEN_INVALIDO', 'Formato de token inválido')
  }

  return token
}

export const requireAuth =
  (dependencies: RequireAuthDependencies) =>
  async (request: FastifyRequest): Promise<void> => {
    const bearerToken = getBearerToken(request)

    let payload
    try {
      payload = verifyAccessToken(bearerToken, dependencies.config)
    } catch {
      throw new HttpError(401, 'TOKEN_INVALIDO', 'No fue posible validar el token')
    }

    const user = await dependencies.prisma.user.findFirst({
      where: {
        id: payload.sub,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    })

    if (!user) {
      throw new HttpError(401, 'USUARIO_NO_ENCONTRADO', 'El usuario autenticado no existe')
    }

    request.authUser = user
  }
