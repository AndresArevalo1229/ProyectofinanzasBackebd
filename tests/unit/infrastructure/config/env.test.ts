import { describe, expect, it } from 'vitest'

import { parseEnvironment } from '../../../../src/infrastructure/config/env.js'

const baseEnv: NodeJS.ProcessEnv = {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_USER: 'root',
  MYSQL_PASSWORD: 'Gl0b@l12345',
  MYSQL_DATABASE: 'MisFinanzas',
  SERVER_PORT: '3100',
  ENCUESTA_EXCLUDED_CLIENT_IDS: '1907,2500',
  CORS_ORIGINS: 'http://localhost:5173,https://app.local',
  LOG_LEVEL: 'debug',
  JWT_ACCESS_SECRET: 'jwt_access_secret_for_tests_123',
  JWT_REFRESH_SECRET: 'jwt_refresh_secret_for_tests_123',
  JWT_ACCESS_TTL: '20m',
  JWT_REFRESH_TTL_DAYS: '45',
  PASSWORD_RESET_TTL_MINUTES: '60',
  WORKSPACE_INVITE_TTL_DAYS: '10',
  RATE_LIMIT_MAX: '10',
  RATE_LIMIT_WINDOW: '2 minutes',
}

describe('parseEnvironment', () => {
  it('parsea variables y deriva DATABASE_URL', () => {
    const config = parseEnvironment(baseEnv)

    expect(config.serverPort).toBe(3100)
    expect(config.mysql.host).toBe('127.0.0.1')
    expect(config.encuestaExcludedClientIds).toEqual([1907, 2500])
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://app.local'])
    expect(config.databaseUrl).toBe('mysql://root:Gl0b%40l12345@127.0.0.1:3306/MisFinanzas')
    expect(config.auth.accessTokenTtl).toBe('20m')
    expect(config.auth.refreshTokenTtlDays).toBe(45)
    expect(config.auth.passwordResetTtlMinutes).toBe(60)
    expect(config.auth.exposePasswordResetToken).toBe(true)
    expect(config.workspace.inviteTtlDays).toBe(10)
    expect(config.security.rateLimitMax).toBe(10)
    expect(config.security.rateLimitWindow).toBe('2 minutes')
  })

  it('usa valores por defecto cuando son omitidos', () => {
    const config = parseEnvironment({
      MYSQL_HOST: '127.0.0.1',
      MYSQL_USER: 'root',
      MYSQL_PASSWORD: 'password',
      MYSQL_DATABASE: 'MisFinanzas',
      JWT_ACCESS_SECRET: 'jwt_access_secret_for_tests_123',
      JWT_REFRESH_SECRET: 'jwt_refresh_secret_for_tests_123',
    })

    expect(config.nodeEnv).toBe('development')
    expect(config.serverPort).toBe(3100)
    expect(config.mysql.port).toBe(3306)
    expect(config.corsOrigins).toEqual(['http://localhost:5173'])
    expect(config.encuestaExcludedClientIds).toEqual([])
    expect(config.logLevel).toBe('info')
    expect(config.auth.accessTokenTtl).toBe('15m')
    expect(config.auth.refreshTokenTtlDays).toBe(30)
    expect(config.auth.passwordResetTtlMinutes).toBe(30)
    expect(config.auth.exposePasswordResetToken).toBe(true)
    expect(config.workspace.inviteTtlDays).toBe(7)
    expect(config.security.rateLimitMax).toBe(5)
    expect(config.security.rateLimitWindow).toBe('1 minute')
  })

  it('desactiva exposición de token en producción por defecto', () => {
    const config = parseEnvironment({
      ...baseEnv,
      NODE_ENV: 'production',
    })

    expect(config.auth.exposePasswordResetToken).toBe(false)
  })

  it('permite sobreescribir exposición con variable explícita', () => {
    const config = parseEnvironment({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_EXPOSE_PASSWORD_RESET_TOKEN: 'true',
    })

    expect(config.auth.exposePasswordResetToken).toBe(true)
  })

  it('falla cuando faltan variables obligatorias', () => {
    expect(() => parseEnvironment({})).toThrow()
  })
})
