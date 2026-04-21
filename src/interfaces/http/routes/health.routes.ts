import type { FastifyInstance } from 'fastify'

import type { ObtenerEstadoSaludUseCase } from '../../../application/health/use-cases/obtener-estado-salud.use-case.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'

export interface HealthRoutesDependencies {
  obtenerEstadoSaludUseCase: Pick<ObtenerEstadoSaludUseCase, 'ejecutar'>
}

export const registerHealthRoutes = (
  app: FastifyInstance,
  dependencies: HealthRoutesDependencies,
): void => {
  app.get('/health', async (request, reply) => {
    const estadoSalud = await dependencies.obtenerEstadoSaludUseCase.ejecutar()
    const statusCode = estadoSalud.estado === 'ok' ? 200 : 503

    return reply.status(statusCode).send(
      crearRespuestaExitosa({
        mensaje: statusCode === 200 ? 'Servicio disponible' : 'Servicio degradado',
        datos: estadoSalud,
        requestId: request.id,
      }),
    )
  })
}
