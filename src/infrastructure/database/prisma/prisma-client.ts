import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@prisma/client'

import type { AppConfig } from '../../config/env.js'

export const createPrismaClient = (
  config: Pick<AppConfig, 'mysql' | 'nodeEnv'>,
): PrismaClient => {
  const adapter = new PrismaMariaDb({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    connectionLimit: 5,
  })

  return new PrismaClient({
    adapter,
    log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  })
}
