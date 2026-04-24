import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

import type { EstadoSalud } from '../../../src/domain/health/estado-salud.js'
import type { AppConfig } from '../../../src/infrastructure/config/env.js'
import type {
  RespuestaError,
  RespuestaExitosa,
} from '../../../src/interfaces/http/contracts/respuesta-http.js'
import { buildHttpApp } from '../../../src/interfaces/http/build-http-app.js'

const baseConfig: AppConfig = {
  nodeEnv: 'test',
  serverPort: 3100,
  mysql: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'password',
    database: 'MisFinanzas',
  },
  encuestaExcludedClientIds: [1907],
  corsOrigins: ['http://localhost:5173'],
  logLevel: 'silent',
  databaseUrl: 'mysql://root:password@127.0.0.1:3306/MisFinanzas',
  auth: {
    accessTokenSecret: 'jwt_access_secret_for_tests_123',
    refreshTokenSecret: 'jwt_refresh_secret_for_tests_123',
    accessTokenTtl: '15m',
    refreshTokenTtlDays: 30,
    passwordResetTtlMinutes: 30,
    exposePasswordResetToken: true,
  },
  workspace: {
    inviteTtlDays: 7,
  },
  security: {
    rateLimitMax: 5,
    rateLimitWindow: '1 minute',
  },
}

const logger = pino({ level: 'silent' })
const prismaMock = {} as unknown as PrismaClient

describe('HTTP app', () => {
  const appsToClose: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    while (appsToClose.length > 0) {
      const app = appsToClose.pop()
      if (app) {
        await app.close()
      }
    }
  })

  it('GET /api/v1/health responde 200 y contrato exitoso', async () => {
    const estadoSalud: EstadoSalud = {
      servicio: 'back_finanzas',
      estado: 'ok',
      fecha: new Date().toISOString(),
      dependencias: {
        baseDatos: 'ok',
      },
    }

    const obtenerEstadoSaludUseCase = {
      ejecutar: vi.fn().mockResolvedValue(estadoSalud),
    }

    const app = await buildHttpApp({
      config: baseConfig,
      logger,
      prisma: prismaMock,
      obtenerEstadoSaludUseCase,
    })
    appsToClose.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    })

    expect(response.statusCode).toBe(200)

    const payload: RespuestaExitosa<EstadoSalud> = response.json()
    expect(payload.exito).toBe(true)
    expect(payload.error).toBeNull()
    expect(payload.mensaje).toBe('Servicio disponible')
    expect(payload.datos).toEqual(estadoSalud)
    expect(typeof payload.meta.requestId).toBe('string')
    expect(payload.meta.requestId.length).toBeGreaterThan(0)
    expect(response.headers['x-request-id']).toBe(payload.meta.requestId)

    expect(obtenerEstadoSaludUseCase.ejecutar).toHaveBeenCalledTimes(1)
  })

  it('ruta inexistente responde 404 con contrato estándar', async () => {
    const app = await buildHttpApp({
      config: baseConfig,
      logger,
      prisma: prismaMock,
      obtenerEstadoSaludUseCase: {
        ejecutar: vi.fn().mockResolvedValue({
          servicio: 'back_finanzas',
          estado: 'ok',
          fecha: new Date().toISOString(),
          dependencias: {
            baseDatos: 'ok',
          },
        }),
      },
    })
    appsToClose.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ruta-no-existe',
    })

    expect(response.statusCode).toBe(404)

    const payload: RespuestaError = response.json()
    expect(payload.exito).toBe(false)
    expect(payload.error.codigo).toBe('RECURSO_NO_ENCONTRADO')
    expect(typeof payload.meta.requestId).toBe('string')
    expect(response.headers['x-request-id']).toBe(payload.meta.requestId)
  })

  it('error interno responde 500 con codigo de negocio y requestId', async () => {
    const app = await buildHttpApp({
      config: baseConfig,
      logger,
      prisma: prismaMock,
      obtenerEstadoSaludUseCase: {
        ejecutar: vi.fn().mockResolvedValue({
          servicio: 'back_finanzas',
          estado: 'ok',
          fecha: new Date().toISOString(),
          dependencias: {
            baseDatos: 'ok',
          },
        }),
      },
    })

    app.get('/api/v1/boom', () => {
      throw new Error('boom')
    })

    appsToClose.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/boom',
    })

    expect(response.statusCode).toBe(500)

    const payload: RespuestaError = response.json()
    expect(payload.exito).toBe(false)
    expect(payload.error.codigo).toBe('ERROR_INTERNO')
    expect(payload.error.detalles).toBeNull()
    expect(typeof payload.meta.requestId).toBe('string')
    expect(response.headers['x-request-id']).toBe(payload.meta.requestId)
  })
})
