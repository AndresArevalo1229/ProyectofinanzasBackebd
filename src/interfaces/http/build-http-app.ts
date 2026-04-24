import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
} from 'fastify'
import { randomUUID } from 'node:crypto'

import { AuthService } from '../../application/auth/auth.service.js'
import { BudgetService } from '../../application/budgets/budget.service.js'
import { ExpansionService } from '../../application/expansion/expansion.service.js'
import { FinanceService } from '../../application/finance/finance.service.js'
import { GoalService } from '../../application/goals/goal.service.js'
import { ReportService } from '../../application/reports/report.service.js'
import { WorkspaceService } from '../../application/workspaces/workspace.service.js'
import type { ObtenerEstadoSaludUseCase } from '../../application/health/use-cases/obtener-estado-salud.use-case.js'
import type { AppConfig } from '../../infrastructure/config/env.js'
import type { PrismaClient } from '@prisma/client'
import { requireAuth } from './middleware/require-auth.js'
import { requireWorkspace } from './middleware/require-workspace.js'
import { registerErrorHandlers } from './handlers/error-handler.js'
import { registerAuthRoutes } from './routes/auth.routes.js'
import { registerBudgetsRoutes } from './routes/budgets.routes.js'
import { registerFinanceRoutes } from './routes/finance.routes.js'
import { registerGoalsRoutes } from './routes/goals.routes.js'
import { registerHealthRoutes } from './routes/health.routes.js'
import { registerReportsRoutes } from './routes/reports.routes.js'
import { registerWorkspacesRoutes } from './routes/workspaces.routes.js'
import { registerExpansionRoutes } from './routes/expansion.routes.js'

interface BuildHttpAppDependencies {
  config: AppConfig
  logger: FastifyBaseLogger
  prisma: PrismaClient
  obtenerEstadoSaludUseCase: Pick<ObtenerEstadoSaludUseCase, 'ejecutar'>
}

const resolveRequestId = (header: string | string[] | undefined): string => {
  if (typeof header === 'string' && header.trim().length > 0) {
    return header
  }

  if (Array.isArray(header) && header.length > 0) {
    return header[0] || randomUUID()
  }

  return randomUUID()
}

export const buildHttpApp = async (
  dependencies: BuildHttpAppDependencies,
): Promise<FastifyInstance> => {
  const app = Fastify({
    disableRequestLogging: true,
    loggerInstance: dependencies.logger,
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
  })

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Mis Finanzas API',
        version: '1.0.0',
        description:
          'API para control financiero personal, en pareja y equipos pequeños.',
      },
      tags: [
        { name: 'Health', description: 'Estado del servicio' },
        { name: 'Auth', description: 'Autenticación y sesiones' },
        { name: 'Workspaces', description: 'Gestión de espacios compartidos' },
        { name: 'Finance', description: 'Cuentas, categorías, movimientos y transferencias' },
        { name: 'Budgets', description: 'Presupuestos por categoría y mes' },
        { name: 'Goals', description: 'Metas y aportaciones' },
        { name: 'Reports', description: 'Dashboard y reportes' },
        { name: 'Expansion', description: 'Módulos en expansión (fase 5)' },
      ],
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    transformSpecificationClone: true,
  })

  await app.register(rateLimit, {
    global: false,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  })

  await app.register(cors, {
    origin: dependencies.config.corsOrigins,
    credentials: true,
  })

  const authService = new AuthService(dependencies.prisma, {
    auth: dependencies.config.auth,
  })
  const workspaceService = new WorkspaceService(dependencies.prisma, {
    workspace: dependencies.config.workspace,
  })
  const financeService = new FinanceService(dependencies.prisma)
  const budgetService = new BudgetService(dependencies.prisma)
  const goalService = new GoalService(dependencies.prisma)
  const reportService = new ReportService(dependencies.prisma)
  const expansionService = new ExpansionService(dependencies.prisma)

  const requireAuthHandler = requireAuth({
    prisma: dependencies.prisma,
    config: dependencies.config,
  })

  const requireWorkspaceHandler = requireWorkspace({
    prisma: dependencies.prisma,
  })

  const requireWorkspaceOwnerHandler = requireWorkspace(
    {
      prisma: dependencies.prisma,
    },
    { ownerOnly: true },
  )

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id)
    done()
  })

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        requestId: request.id,
        statusCode: reply.statusCode,
        url: request.url,
      },
      'Solicitud completada',
    )
    done()
  })

  registerErrorHandlers(app)

  await app.register(
    (v1, _opts, done) => {
      registerHealthRoutes(v1, {
        obtenerEstadoSaludUseCase: dependencies.obtenerEstadoSaludUseCase,
      })

      registerAuthRoutes(v1, {
        authService,
        security: {
          rateLimitMax: dependencies.config.security.rateLimitMax,
          rateLimitWindow: dependencies.config.security.rateLimitWindow,
        },
      })

      registerWorkspacesRoutes(v1, {
        workspaceService,
        prisma: dependencies.prisma,
        requireAuth: requireAuthHandler,
        requireWorkspace: requireWorkspaceHandler,
      })

      registerFinanceRoutes(v1, {
        financeService,
        requireAuth: requireAuthHandler,
        requireWorkspace: requireWorkspaceHandler,
      })

      registerBudgetsRoutes(v1, {
        budgetService,
        requireAuth: requireAuthHandler,
        requireWorkspace: requireWorkspaceHandler,
        requireWorkspaceOwner: requireWorkspaceOwnerHandler,
      })

      registerGoalsRoutes(v1, {
        goalService,
        requireAuth: requireAuthHandler,
        requireWorkspace: requireWorkspaceHandler,
      })

      registerReportsRoutes(v1, {
        reportService,
        requireAuth: requireAuthHandler,
        requireWorkspace: requireWorkspaceHandler,
      })

      registerExpansionRoutes(v1, {
        expansionService,
        requireAuth: requireAuthHandler,
        requireWorkspace: requireWorkspaceHandler,
      })

      done()
    },
    { prefix: '/api/v1' },
  )

  return app
}
