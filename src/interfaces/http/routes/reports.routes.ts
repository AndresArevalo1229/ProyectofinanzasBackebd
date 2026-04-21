import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { ReportService } from '../../../application/reports/report.service.js'
import { crearRespuestaExitosa } from '../contracts/respuesta-http.js'
import { getWorkspaceContext } from '../utils/request-context.js'
import { validateWithSchema } from '../utils/validation.js'

interface ReportsRoutesDependencies {
  reportService: ReportService
  requireAuth: (request: FastifyRequest) => Promise<void>
  requireWorkspace: (request: FastifyRequest) => Promise<void>
}

const periodSchema = z.enum(['day', 'week', 'month', 'year', 'custom'])

const reportQuerySchema = z.object({
  period: periodSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  anchorDate: z.string().datetime().optional(),
})

export const registerReportsRoutes = (
  app: FastifyInstance,
  dependencies: ReportsRoutesDependencies,
): void => {
  const preHandlers = [dependencies.requireAuth, dependencies.requireWorkspace]

  app.get(
    '/dashboard/summary',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Resumen del dashboard',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const filters = validateWithSchema(reportQuerySchema, request.query)

      const summary = await dependencies.reportService.getDashboardSummary(workspace, filters)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Resumen obtenido',
          datos: summary,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/reports/by-category',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Reporte por categoría',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const filters = validateWithSchema(reportQuerySchema, request.query)

      const report = await dependencies.reportService.getByCategory(workspace, filters)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Reporte por categoría obtenido',
          datos: report,
          requestId: request.id,
        }),
      )
    },
  )

  app.get(
    '/reports/cashflow',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Flujo de caja por día',
      },
      preHandler: preHandlers,
    },
    async (request, reply) => {
      const workspace = getWorkspaceContext(request)
      const filters = validateWithSchema(reportQuerySchema, request.query)

      const report = await dependencies.reportService.getCashflow(workspace, filters)

      return reply.send(
        crearRespuestaExitosa({
          mensaje: 'Reporte cashflow obtenido',
          datos: report,
          requestId: request.id,
        }),
      )
    },
  )
}
