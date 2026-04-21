import type { FastifyBaseLogger } from 'fastify'
import pino from 'pino'

import type { AppConfig } from '../config/env.js'

export const createLogger = (
  config: Pick<AppConfig, 'logLevel'>,
): FastifyBaseLogger => {
  return pino({
    level: config.logLevel,
  })
}
