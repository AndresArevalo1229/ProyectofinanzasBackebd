import type { FastifyError, FastifyInstance } from 'fastify'

import { crearRespuestaError } from '../contracts/respuesta-http.js'
import { HttpError } from '../errors/http-error.js'

const isFastifyValidationError = (
  error: unknown,
): error is FastifyError & { validation: unknown } => {
  return typeof error === 'object' && error !== null && 'validation' in error
}

const isHttpErrorLike = (
  error: unknown,
): error is {
  statusCode: number
  codigo: string
  message: string
  detalles?: unknown
} => {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const candidate = error as Record<string, unknown>

  return (
    typeof candidate.statusCode === 'number' &&
    typeof candidate.codigo === 'string' &&
    typeof candidate.message === 'string'
  )
}

export const registerErrorHandlers = (app: FastifyInstance): void => {
  app.setNotFoundHandler(async (request, reply) => {
    reply.status(404).send(
      crearRespuestaError({
        codigo: 'RECURSO_NO_ENCONTRADO',
        mensaje: 'La ruta solicitada no existe',
        requestId: request.id,
      }),
    )
  })

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof HttpError || isHttpErrorLike(error)) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, requestId: request.id }, 'Error HTTP controlado')
      }

      reply.status(error.statusCode).send(
        crearRespuestaError({
          codigo: error.codigo,
          mensaje: error.message,
          requestId: request.id,
          detalles: error.detalles,
        }),
      )
      return
    }

    if (isFastifyValidationError(error)) {
      reply.status(400).send(
        crearRespuestaError({
          codigo: 'SOLICITUD_INVALIDA',
          mensaje: 'Los datos enviados no son válidos',
          requestId: request.id,
          detalles: error.validation,
        }),
      )
      return
    }

    request.log.error({ err: error, requestId: request.id }, 'Error interno no controlado')

    reply.status(500).send(
      crearRespuestaError({
        codigo: 'ERROR_INTERNO',
        mensaje: 'Ocurrió un error interno en el servidor',
        requestId: request.id,
      }),
    )
  })
}
