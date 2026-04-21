import { ObtenerEstadoSaludUseCase } from './application/health/use-cases/obtener-estado-salud.use-case.js'
import { loadEnvironment } from './infrastructure/config/env.js'
import { PrismaIndicadorSaludBaseDatos } from './infrastructure/database/prisma/prisma-indicador-salud.js'
import { createPrismaClient } from './infrastructure/database/prisma/prisma-client.js'
import { createLogger } from './infrastructure/logging/create-logger.js'
import { buildHttpApp } from './interfaces/http/build-http-app.js'

const startServer = async (): Promise<void> => {
  const config = loadEnvironment()
  const logger = createLogger(config)

  const prismaClient = createPrismaClient(config)
  await prismaClient.$connect()

  const indicadorSaludBaseDatos = new PrismaIndicadorSaludBaseDatos(prismaClient)
  const obtenerEstadoSaludUseCase = new ObtenerEstadoSaludUseCase(indicadorSaludBaseDatos)

  const app = await buildHttpApp({
    config,
    logger,
    prisma: prismaClient,
    obtenerEstadoSaludUseCase,
  })

  let shuttingDown = false

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    logger.info({ signal }, 'Iniciando apagado controlado')

    await app.close()
    await prismaClient.$disconnect()

    logger.info('Servidor detenido correctamente')
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  await app.listen({
    host: '0.0.0.0',
    port: config.serverPort,
  })

  logger.info({ port: config.serverPort }, 'Servidor HTTP iniciado')
}

startServer().catch((error: unknown) => {
  console.error('No fue posible iniciar el servidor', error)
  process.exit(1)
})
