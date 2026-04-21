import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { AuthService } from '../../../application/auth/auth.service.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getRequestMetadata } from '../utils/request-metadata.js'
import { validateWithSchema } from '../utils/validation.js'

interface AuthRoutesDependencies {
  authService: AuthService
  security: {
    rateLimitMax: number
    rateLimitWindow: string
  }
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
  workspaceName: z.string().min(2).optional(),
  baseCurrency: z.string().length(3).optional(),
  timezone: z.string().min(3).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
})

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8),
})

export const registerAuthRoutes = (
  app: FastifyInstance,
  dependencies: AuthRoutesDependencies,
): void => {
  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Registrar usuario',
      },
      config: {
        rateLimit: {
          max: dependencies.security.rateLimitMax,
          timeWindow: dependencies.security.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const input = validateWithSchema(registerSchema, request.body)

      const result = await dependencies.authService.register(input, getRequestMetadata(request))

      return reply.status(201).send(
        crearRespuestaExitosa({
          mensaje: 'Registro exitoso',
          datos: result,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Iniciar sesión',
      },
      config: {
        rateLimit: {
          max: dependencies.security.rateLimitMax,
          timeWindow: dependencies.security.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const input = validateWithSchema(loginSchema, request.body)

      const result = await dependencies.authService.login(input, getRequestMetadata(request))

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Inicio de sesión exitoso',
          datos: result,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refrescar sesión',
      },
      config: {
        rateLimit: {
          max: dependencies.security.rateLimitMax,
          timeWindow: dependencies.security.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const input = validateWithSchema(refreshSchema, request.body)

      const result = await dependencies.authService.refreshSession(
        input.refreshToken,
        getRequestMetadata(request),
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Sesión refrescada',
          datos: result,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Cerrar sesión',
      },
      config: {
        rateLimit: {
          max: dependencies.security.rateLimitMax,
          timeWindow: dependencies.security.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const input = validateWithSchema(refreshSchema, request.body)

      await dependencies.authService.logout(input.refreshToken, getRequestMetadata(request))

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Sesión cerrada',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/auth/password/forgot',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Solicitar recuperación de contraseña',
      },
      config: {
        rateLimit: {
          max: dependencies.security.rateLimitMax,
          timeWindow: dependencies.security.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const input = validateWithSchema(forgotPasswordSchema, request.body)

      const result = await dependencies.authService.forgotPassword(
        input,
        getRequestMetadata(request),
      )

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Si el correo existe, se generó un token de recuperación',
          datos: result,
          requestId: request.id,
        }),
      )
    },
  )

  app.post(
    '/auth/password/reset',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Restablecer contraseña',
      },
      config: {
        rateLimit: {
          max: dependencies.security.rateLimitMax,
          timeWindow: dependencies.security.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const input = validateWithSchema(resetPasswordSchema, request.body)

      await dependencies.authService.resetPassword(input, getRequestMetadata(request))

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Contraseña actualizada',
          datos: {
            ok: true,
          },
          requestId: request.id,
        }),
      )
    },
  )
}
