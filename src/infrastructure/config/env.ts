import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

import { buildDatabaseUrl } from './build-database-url.js'
import {
  parseBooleanFlag,
  parseCorsOrigins,
  parseEncuestaExcludedClientIds,
} from './parsers.js'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3100),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().min(1),
  MYSQL_DATABASE: z.string().min(1),
  ENCUESTA_EXCLUDED_CLIENT_IDS: z.string().default(''),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  AUTH_EXPOSE_PASSWORD_RESET_TOKEN: z.string().optional(),
  WORKSPACE_INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
})

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  serverPort: number
  mysql: {
    host: string
    port: number
    user: string
    password: string
    database: string
  }
  encuestaExcludedClientIds: number[]
  corsOrigins: string[]
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  databaseUrl: string
  auth: {
    accessTokenSecret: string
    refreshTokenSecret: string
    accessTokenTtl: string
    refreshTokenTtlDays: number
    passwordResetTtlMinutes: number
    exposePasswordResetToken: boolean
  }
  workspace: {
    inviteTtlDays: number
  }
  security: {
    rateLimitMax: number
    rateLimitWindow: string
  }
}

export const parseEnvironment = (rawEnv: NodeJS.ProcessEnv): AppConfig => {
  const parsed = envSchema.parse(rawEnv)

  const mysql = {
    host: parsed.MYSQL_HOST,
    port: parsed.MYSQL_PORT,
    user: parsed.MYSQL_USER,
    password: parsed.MYSQL_PASSWORD,
    database: parsed.MYSQL_DATABASE,
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    serverPort: parsed.SERVER_PORT,
    mysql,
    encuestaExcludedClientIds: parseEncuestaExcludedClientIds(
      parsed.ENCUESTA_EXCLUDED_CLIENT_IDS,
    ),
    corsOrigins: parseCorsOrigins(parsed.CORS_ORIGINS),
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: buildDatabaseUrl(mysql),
    auth: {
      accessTokenSecret: parsed.JWT_ACCESS_SECRET,
      refreshTokenSecret: parsed.JWT_REFRESH_SECRET,
      accessTokenTtl: parsed.JWT_ACCESS_TTL,
      refreshTokenTtlDays: parsed.JWT_REFRESH_TTL_DAYS,
      passwordResetTtlMinutes: parsed.PASSWORD_RESET_TTL_MINUTES,
      exposePasswordResetToken: parseBooleanFlag(
        parsed.AUTH_EXPOSE_PASSWORD_RESET_TOKEN,
        parsed.NODE_ENV !== 'production',
        'AUTH_EXPOSE_PASSWORD_RESET_TOKEN',
      ),
    },
    workspace: {
      inviteTtlDays: parsed.WORKSPACE_INVITE_TTL_DAYS,
    },
    security: {
      rateLimitMax: parsed.RATE_LIMIT_MAX,
      rateLimitWindow: parsed.RATE_LIMIT_WINDOW,
    },
  }
}

export const loadEnvironment = (): AppConfig => {
  loadDotEnv()
  return parseEnvironment(process.env)
}
