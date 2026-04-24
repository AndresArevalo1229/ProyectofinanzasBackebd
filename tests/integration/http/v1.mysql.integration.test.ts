import { config as loadDotEnv } from 'dotenv'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ObtenerEstadoSaludUseCase } from '../../../src/application/health/use-cases/obtener-estado-salud.use-case.js'
import { PrismaIndicadorSaludBaseDatos } from '../../../src/infrastructure/database/prisma/prisma-indicador-salud.js'
import { createPrismaClient } from '../../../src/infrastructure/database/prisma/prisma-client.js'
import { parseEnvironment } from '../../../src/infrastructure/config/env.js'
import type {
  RespuestaError,
  RespuestaExitosa,
} from '../../../src/interfaces/http/contracts/respuesta-http.js'
import { buildHttpApp } from '../../../src/interfaces/http/build-http-app.js'

loadDotEnv()

const runDbIntegration = process.env.RUN_DB_INTEGRATION === '1'
const describeDb = runDbIntegration ? describe : describe.skip

interface AuthResult {
  user: {
    id: string
    email: string
    displayName: string
  }
  workspaces: Array<{
    id: string
    name: string
    role: 'OWNER' | 'MEMBER'
    baseCurrency: string
    timezone: string
  }>
  tokens: {
    accessToken: string
    refreshToken: string
    tokenType: 'Bearer'
    expiresIn: string
  }
}

describeDb('HTTP v1 con MySQL real', () => {
  const logger = pino({ level: 'silent' })
  const now = Date.now().toString(36)

  const config = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    MYSQL_HOST: process.env.MYSQL_HOST ?? '127.0.0.1',
    MYSQL_PORT: process.env.MYSQL_PORT ?? '3306',
    MYSQL_USER: process.env.MYSQL_USER ?? 'root',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? 'password',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? 'MisFinanzas',
    SERVER_PORT: process.env.SERVER_PORT ?? '3100',
    ENCUESTA_EXCLUDED_CLIENT_IDS: process.env.ENCUESTA_EXCLUDED_CLIENT_IDS ?? '1907',
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    JWT_ACCESS_SECRET:
      process.env.JWT_ACCESS_SECRET ?? 'jwt_access_secret_for_tests_123456',
    JWT_REFRESH_SECRET:
      process.env.JWT_REFRESH_SECRET ?? 'jwt_refresh_secret_for_tests_123456',
    JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '15m',
    JWT_REFRESH_TTL_DAYS: process.env.JWT_REFRESH_TTL_DAYS ?? '30',
    PASSWORD_RESET_TTL_MINUTES: process.env.PASSWORD_RESET_TTL_MINUTES ?? '30',
    WORKSPACE_INVITE_TTL_DAYS: process.env.WORKSPACE_INVITE_TTL_DAYS ?? '7',
    RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_WINDOW: '1 minute',
  })

  const prisma = createPrismaClient(config)

  let app: Awaited<ReturnType<typeof buildHttpApp>>

  const randomSuffix = (): string => `${now}-${Math.random().toString(36).slice(2, 10)}`

  const uniqueEmail = (prefix: string): string => {
    return `${prefix}.${randomSuffix()}@misfinanzas.local`
  }

  const register = async (args: {
    email: string
    password: string
    displayName: string
    workspaceName?: string
  }): Promise<AuthResult> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: args.email,
        password: args.password,
        displayName: args.displayName,
        workspaceName: args.workspaceName,
      },
    })

    expect(response.statusCode).toBe(201)

    const payload = response.json<RespuestaExitosa<AuthResult>>()
    expect(payload.exito).toBe(true)
    expect(payload.error).toBeNull()
    expect(typeof payload.meta.requestId).toBe('string')

    return payload.datos
  }

  const login = async (email: string, password: string): Promise<AuthResult> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email,
        password,
      },
    })

    expect(response.statusCode).toBe(200)

    const payload = response.json<RespuestaExitosa<AuthResult>>()
    expect(payload.exito).toBe(true)

    return payload.datos
  }

  beforeAll(async () => {
    await prisma.$connect()

    const indicadorSaludBaseDatos = new PrismaIndicadorSaludBaseDatos(prisma)
    const obtenerEstadoSaludUseCase = new ObtenerEstadoSaludUseCase(indicadorSaludBaseDatos)

    app = await buildHttpApp({
      config,
      logger,
      prisma,
      obtenerEstadoSaludUseCase,
    })
  }, 60_000)

  afterAll(async () => {
    if (app) {
      await app.close()
    }
    await prisma.$disconnect()
  }, 60_000)

  it('completa auth: register/login/refresh/logout con rotación de refresh token', async () => {
    const email = uniqueEmail('auth')
    const password = 'SecurePass123!'

    const registered = await register({
      email,
      password,
      displayName: 'Usuario Auth',
      workspaceName: 'Espacio Auth',
    })

    const loginResult = await login(email, password)

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        refreshToken: loginResult.tokens.refreshToken,
      },
    })

    expect(refreshResponse.statusCode).toBe(200)

    const refreshPayload = refreshResponse.json<RespuestaExitosa<{ tokens: AuthResult['tokens'] }>>()
    expect(refreshPayload.exito).toBe(true)

    const rotatedRefreshToken = refreshPayload.datos.tokens.refreshToken
    expect(rotatedRefreshToken).not.toBe(loginResult.tokens.refreshToken)

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: {
        refreshToken: rotatedRefreshToken,
      },
    })

    expect(logoutResponse.statusCode).toBe(200)

    const invalidRefreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        refreshToken: rotatedRefreshToken,
      },
    })

    expect(invalidRefreshResponse.statusCode).toBe(401)
    const invalidRefreshPayload = invalidRefreshResponse.json<Record<string, unknown>>()

    if ('exito' in invalidRefreshPayload) {
      const payload = invalidRefreshPayload as RespuestaError
      expect(payload.exito).toBe(false)
      expect(payload.error.codigo).toBe('REFRESH_TOKEN_INVALIDO')
    } else {
      expect(invalidRefreshPayload.statusCode).toBe(401)
    }

    expect(registered.workspaces.length).toBeGreaterThan(0)
  })

  it('permite invitar y unir miembros al workspace', async () => {
    const owner = await register({
      email: uniqueEmail('owner'),
      password: 'SecurePass123!',
      displayName: 'Owner',
      workspaceName: 'Workspace Equipo',
    })
    const member = await register({
      email: uniqueEmail('member'),
      password: 'SecurePass123!',
      displayName: 'Member',
      workspaceName: 'Workspace Personal Member',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })

    expect(inviteResponse.statusCode).toBe(201)
    const invitePayload = inviteResponse.json<
      RespuestaExitosa<{ code: string; workspaceId: string; expiresAt: string }>
    >()
    expect(invitePayload.exito).toBe(true)

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/join',
      headers: {
        authorization: `Bearer ${member.tokens.accessToken}`,
      },
      payload: {
        code: invitePayload.datos.code,
      },
    })

    expect(joinResponse.statusCode).toBe(200)
    const joinPayload = joinResponse.json<RespuestaExitosa<{ workspaceId: string; role: string }>>()
    expect(joinPayload.exito).toBe(true)
    expect(joinPayload.datos.workspaceId).toBe(workspaceId)

    const membersResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/members`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })

    expect(membersResponse.statusCode).toBe(200)
    const membersPayload = membersResponse.json<
      RespuestaExitosa<Array<{ email: string; role: 'OWNER' | 'MEMBER' }>>
    >()
    expect(membersPayload.exito).toBe(true)
    expect(membersPayload.datos.some((item) => item.email === owner.user.email)).toBe(true)
    expect(membersPayload.datos.some((item) => item.email === member.user.email)).toBe(true)
  })

  it('lista y revoca invitaciones con validaciones de permisos y estado', async () => {
    const owner = await register({
      email: uniqueEmail('owner-invites-adv'),
      password: 'SecurePass123!',
      displayName: 'Owner Invites Adv',
      workspaceName: 'Workspace Invitaciones Avanzadas',
    })
    const member = await register({
      email: uniqueEmail('member-invites-adv'),
      password: 'SecurePass123!',
      displayName: 'Member Invites Adv',
      workspaceName: 'Workspace Personal Invitaciones',
    })
    const outsider = await register({
      email: uniqueEmail('outsider-invites-adv'),
      password: 'SecurePass123!',
      displayName: 'Outsider Invites Adv',
      workspaceName: 'Workspace Outsider Invitaciones',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const invitePendingResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(invitePendingResponse.statusCode).toBe(201)
    const invitePendingPayload = invitePendingResponse.json<
      RespuestaExitosa<{ code: string; workspaceId: string }>
    >()

    const inviteForMemberResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(inviteForMemberResponse.statusCode).toBe(201)
    const inviteForMemberCode = inviteForMemberResponse.json<
      RespuestaExitosa<{ code: string }>
    >().datos.code

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/join',
      headers: {
        authorization: `Bearer ${member.tokens.accessToken}`,
      },
      payload: {
        code: inviteForMemberCode,
      },
    })
    expect(joinResponse.statusCode).toBe(200)

    const ownerListResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(ownerListResponse.statusCode).toBe(200)
    const ownerListPayload = ownerListResponse.json<
      RespuestaExitosa<
        Array<{
          id: string
          code: string
          status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
        }>
      >
    >()
    expect(ownerListPayload.exito).toBe(true)
    expect(ownerListPayload.datos.length).toBeGreaterThanOrEqual(2)

    const pendingInvite = ownerListPayload.datos.find(
      (item) => item.code === invitePendingPayload.datos.code,
    )
    expect(pendingInvite).toBeDefined()
    expect(pendingInvite?.status).toBe('PENDING')
    const pendingInviteId = pendingInvite?.id
    expect(pendingInviteId).toBeDefined()

    const memberListResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${member.tokens.accessToken}`,
      },
    })
    expect(memberListResponse.statusCode).toBe(403)
    const memberListPayload = memberListResponse.json<RespuestaError>()
    expect(memberListPayload.error.codigo).toBe('PERMISO_DENEGADO')

    const outsiderListResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${outsider.tokens.accessToken}`,
      },
    })
    expect(outsiderListResponse.statusCode).toBe(403)
    const outsiderListPayload = outsiderListResponse.json<RespuestaError>()
    expect(outsiderListPayload.error.codigo).toBe('WORKSPACE_SIN_ACCESO')

    const revokePendingResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites/${pendingInviteId ?? ''}/revoke`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(revokePendingResponse.statusCode).toBe(200)
    const revokePendingPayload = revokePendingResponse.json<
      RespuestaExitosa<{ id: string; status: 'REVOKED' }>
    >()
    expect(revokePendingPayload.exito).toBe(true)
    expect(revokePendingPayload.datos.status).toBe('REVOKED')

    const ownerListAfterRevokeResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(ownerListAfterRevokeResponse.statusCode).toBe(200)
    const ownerListAfterRevokePayload = ownerListAfterRevokeResponse.json<
      RespuestaExitosa<
        Array<{
          id: string
          status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
        }>
      >
    >()
    const revokedInvite = ownerListAfterRevokePayload.datos.find(
      (item) => item.id === pendingInviteId,
    )
    expect(revokedInvite?.status).toBe('REVOKED')

    const acceptedInvite = ownerListAfterRevokePayload.datos.find((item) => item.status === 'ACCEPTED')
    expect(acceptedInvite).toBeDefined()
    const acceptedInviteId = acceptedInvite?.id
    expect(acceptedInviteId).toBeDefined()

    const revokeAcceptedResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites/${acceptedInviteId ?? ''}/revoke`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(revokeAcceptedResponse.statusCode).toBe(400)
    const revokeAcceptedPayload = revokeAcceptedResponse.json<RespuestaError>()
    expect(revokeAcceptedPayload.error.codigo).toBe('INVITACION_NO_REVOCABLE')

    const revokeNotFoundResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites/invite-no-existe/revoke`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(revokeNotFoundResponse.statusCode).toBe(404)
    const revokeNotFoundPayload = revokeNotFoundResponse.json<RespuestaError>()
    expect(revokeNotFoundPayload.error.codigo).toBe('INVITACION_NO_ENCONTRADA')
  })

  it('obtiene workspace actual y valida errores de acceso/selección', async () => {
    const owner = await register({
      email: uniqueEmail('owner-current'),
      password: 'SecurePass123!',
      displayName: 'Owner Current',
      workspaceName: 'Workspace Current',
    })
    const outsider = await register({
      email: uniqueEmail('outsider-current'),
      password: 'SecurePass123!',
      displayName: 'Outsider Current',
      workspaceName: 'Workspace Outsider',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const successResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
        'x-workspace-id': workspaceId ?? '',
      },
    })

    expect(successResponse.statusCode).toBe(200)
    const successPayload = successResponse.json<
      RespuestaExitosa<{
        id: string
        name: string
        role: 'OWNER' | 'MEMBER'
        baseCurrency: string
        timezone: string
        membersCount: number
      }>
    >()
    expect(successPayload.exito).toBe(true)
    expect(successPayload.datos.id).toBe(workspaceId)
    expect(successPayload.datos.role).toBe('OWNER')
    expect(successPayload.datos.membersCount).toBeGreaterThan(0)

    const missingHeaderResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })

    expect(missingHeaderResponse.statusCode).toBe(400)
    const missingHeaderPayload = missingHeaderResponse.json<RespuestaError>()
    expect(missingHeaderPayload.exito).toBe(false)
    expect(missingHeaderPayload.error.codigo).toBe('WORKSPACE_NO_SELECCIONADO')

    const forbiddenResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${outsider.tokens.accessToken}`,
        'x-workspace-id': workspaceId ?? '',
      },
    })

    expect(forbiddenResponse.statusCode).toBe(403)
    const forbiddenPayload = forbiddenResponse.json<RespuestaError>()
    expect(forbiddenPayload.exito).toBe(false)
    expect(forbiddenPayload.error.codigo).toBe('WORKSPACE_SIN_ACCESO')
  })

  it('ejecuta flujo financiero: cuentas, movimientos, transferencias, metas y reportes', async () => {
    const owner = await register({
      email: uniqueEmail('finance'),
      password: 'SecurePass123!',
      displayName: 'Finance Owner',
      workspaceName: 'Workspace Finanzas',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const commonHeaders = {
      authorization: `Bearer ${owner.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }

    const accountAResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: commonHeaders,
      payload: {
        name: 'Caja',
        type: 'CASH',
        initialBalance: 100000,
      },
    })
    expect(accountAResponse.statusCode).toBe(201)
    const accountA = accountAResponse.json<RespuestaExitosa<{ id: string }>>().datos

    const accountBResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: commonHeaders,
      payload: {
        name: 'Banco',
        type: 'BANK',
      },
    })
    expect(accountBResponse.statusCode).toBe(201)
    const accountB = accountBResponse.json<RespuestaExitosa<{ id: string }>>().datos

    const categoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: commonHeaders,
      payload: {
        name: `Comida ${randomSuffix()}`,
        type: 'EXPENSE',
      },
    })
    expect(categoryResponse.statusCode).toBe(201)
    const category = categoryResponse.json<RespuestaExitosa<{ id: string }>>().datos

    const nowIso = new Date().toISOString()

    const incomeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: commonHeaders,
      payload: {
        accountId: accountA.id,
        type: 'INCOME',
        amount: 300000,
        occurredAt: nowIso,
        description: 'Pago mensual',
        tags: ['necessary', 'fixed'],
      },
    })
    expect(incomeResponse.statusCode).toBe(201)

    const expenseResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: commonHeaders,
      payload: {
        accountId: accountA.id,
        categoryId: category.id,
        type: 'EXPENSE',
        amount: 120000,
        occurredAt: nowIso,
        description: 'Supermercado',
        tags: ['necessary', 'variable'],
      },
    })
    expect(expenseResponse.statusCode).toBe(201)

    const transferResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: commonHeaders,
      payload: {
        fromAccountId: accountA.id,
        toAccountId: accountB.id,
        amount: 50000,
        transferredAt: nowIso,
        description: 'Mover a banco',
      },
    })
    expect(transferResponse.statusCode).toBe(201)

    const goalResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/goals',
      headers: commonHeaders,
      payload: {
        name: 'Fondo de emergencia',
        targetAmount: 800000,
      },
    })
    expect(goalResponse.statusCode).toBe(201)
    const goal = goalResponse.json<RespuestaExitosa<{ id: string }>>().datos

    const contributionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/goals/${goal.id}/contributions`,
      headers: commonHeaders,
      payload: {
        amount: 50000,
        contributedAt: nowIso,
        notes: 'Ahorro quincenal',
      },
    })
    expect(contributionResponse.statusCode).toBe(201)

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary?period=month',
      headers: commonHeaders,
    })
    expect(summaryResponse.statusCode).toBe(200)
    const summaryPayload = summaryResponse.json<
      RespuestaExitosa<{
        ingresos: number
        egresos: number
        ahorroNeto: number
        saldoNeto: number
        topAccounts: Array<{ id: string; balance: number }>
      }>
    >()
    expect(summaryPayload.exito).toBe(true)
    expect(summaryPayload.datos.ingresos).toBeGreaterThanOrEqual(300000)
    expect(summaryPayload.datos.egresos).toBeGreaterThanOrEqual(120000)
    expect(summaryPayload.datos.topAccounts.length).toBeGreaterThan(0)

    const byCategoryResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/by-category?period=month',
      headers: commonHeaders,
    })
    expect(byCategoryResponse.statusCode).toBe(200)
    const byCategoryPayload = byCategoryResponse.json<
      RespuestaExitosa<Array<{ categoryId: string | null; total: number }>>
    >()
    expect(byCategoryPayload.exito).toBe(true)
    expect(byCategoryPayload.datos.some((row) => row.total > 0)).toBe(true)

    const cashflowResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/cashflow?period=month',
      headers: commonHeaders,
    })
    expect(cashflowResponse.statusCode).toBe(200)
    const cashflowPayload = cashflowResponse.json<
      RespuestaExitosa<{ serie: Array<{ fecha: string; neto: number }> }>
    >()
    expect(cashflowPayload.exito).toBe(true)
    expect(cashflowPayload.datos.serie.length).toBeGreaterThan(0)
  })

  it('valida conflictos de unicidad para categorías con error funcional 409', async () => {
    const owner = await register({
      email: uniqueEmail('finance-categories'),
      password: 'SecurePass123!',
      displayName: 'Finance Categories Owner',
      workspaceName: 'Workspace Categorias',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const headers = {
      authorization: `Bearer ${owner.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }

    const categoryName = `Categoria unica ${randomSuffix()}`

    const firstCategoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers,
      payload: {
        name: categoryName,
        type: 'EXPENSE',
      },
    })

    expect(firstCategoryResponse.statusCode).toBe(201)
    const firstCategoryId = firstCategoryResponse.json<RespuestaExitosa<{ id: string }>>().datos.id
    expect(firstCategoryId).toBeDefined()

    const duplicateCategoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers,
      payload: {
        name: categoryName,
        type: 'EXPENSE',
      },
    })

    expect(duplicateCategoryResponse.statusCode).toBe(409)
    const duplicatePayload = duplicateCategoryResponse.json<RespuestaError>()
    expect(duplicatePayload.error.codigo).toBe('CATEGORIA_DUPLICADA')

    const secondCategoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers,
      payload: {
        name: `${categoryName} alternativa`,
        type: 'EXPENSE',
      },
    })
    expect(secondCategoryResponse.statusCode).toBe(201)
    const secondCategoryId = secondCategoryResponse
      .json<RespuestaExitosa<{ id: string }>>()
      .datos.id

    const updateToDuplicateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${secondCategoryId}`,
      headers,
      payload: {
        name: categoryName,
      },
    })

    expect(updateToDuplicateResponse.statusCode).toBe(409)
    const updateDuplicatePayload = updateToDuplicateResponse.json<RespuestaError>()
    expect(updateDuplicatePayload.error.codigo).toBe('CATEGORIA_DUPLICADA')
  })

  it('retorna 400 para filtros de periodo inválidos y evita 500 por error de cliente', async () => {
    const owner = await register({
      email: uniqueEmail('period-invalid'),
      password: 'SecurePass123!',
      displayName: 'Period Invalid Owner',
      workspaceName: 'Workspace Periodos',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const headers = {
      authorization: `Bearer ${owner.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }

    const missingRangeResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?period=custom',
      headers,
    })
    expect(missingRangeResponse.statusCode).toBe(400)
    const missingRangePayload = missingRangeResponse.json<RespuestaError>()
    expect(missingRangePayload.error.codigo).toBe('PERIODO_INVALIDO')

    const invalidRangeResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/cashflow?period=custom&from=2026-05-30T23:59:59.000Z&to=2026-04-30T23:59:59.000Z',
      headers,
    })
    expect(invalidRangeResponse.statusCode).toBe(400)
    const invalidRangePayload = invalidRangeResponse.json<RespuestaError>()
    expect(invalidRangePayload.error.codigo).toBe('PERIODO_INVALIDO')
  })

  it('gestiona CRUD de presupuestos con permisos, validaciones y unicidad', async () => {
    const owner = await register({
      email: uniqueEmail('budget-owner'),
      password: 'SecurePass123!',
      displayName: 'Budget Owner',
      workspaceName: 'Workspace Budget',
    })
    const member = await register({
      email: uniqueEmail('budget-member'),
      password: 'SecurePass123!',
      displayName: 'Budget Member',
      workspaceName: 'Workspace Personal Budget Member',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invites`,
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
      },
    })
    expect(inviteResponse.statusCode).toBe(201)
    const inviteCode = inviteResponse
      .json<RespuestaExitosa<{ code: string }>>()
      .datos.code

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/join',
      headers: {
        authorization: `Bearer ${member.tokens.accessToken}`,
      },
      payload: {
        code: inviteCode,
      },
    })
    expect(joinResponse.statusCode).toBe(200)

    const ownerHeaders = {
      authorization: `Bearer ${owner.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }
    const memberHeaders = {
      authorization: `Bearer ${member.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }

    const expenseCategoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: ownerHeaders,
      payload: {
        name: `Budget expense ${randomSuffix()}`,
        type: 'EXPENSE',
      },
    })
    expect(expenseCategoryResponse.statusCode).toBe(201)
    const expenseCategoryId = expenseCategoryResponse
      .json<RespuestaExitosa<{ id: string }>>()
      .datos.id

    const incomeCategoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: ownerHeaders,
      payload: {
        name: `Budget income ${randomSuffix()}`,
        type: 'INCOME',
      },
    })
    expect(incomeCategoryResponse.statusCode).toBe(201)
    const incomeCategoryId = incomeCategoryResponse
      .json<RespuestaExitosa<{ id: string }>>()
      .datos.id

    const memberCreateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/budgets',
      headers: memberHeaders,
      payload: {
        categoryId: expenseCategoryId,
        yearMonth: '2026-04',
        limitAmount: 100_000,
      },
    })
    expect(memberCreateResponse.statusCode).toBe(403)
    const memberCreatePayload = memberCreateResponse.json<RespuestaError>()
    expect(memberCreatePayload.error.codigo).toBe('PERMISO_DENEGADO')

    const createBudgetResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/budgets',
      headers: ownerHeaders,
      payload: {
        categoryId: expenseCategoryId,
        yearMonth: '2026-04',
        limitAmount: 100_000,
        notes: 'Budget inicial',
      },
    })
    expect(createBudgetResponse.statusCode).toBe(201)
    const createdBudget = createBudgetResponse.json<RespuestaExitosa<{ id: string }>>().datos

    const duplicateBudgetResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/budgets',
      headers: ownerHeaders,
      payload: {
        categoryId: expenseCategoryId,
        yearMonth: '2026-04',
        limitAmount: 200_000,
      },
    })
    expect(duplicateBudgetResponse.statusCode).toBe(409)
    const duplicatePayload = duplicateBudgetResponse.json<RespuestaError>()
    expect(duplicatePayload.error.codigo).toBe('PRESUPUESTO_DUPLICADO')

    const invalidCategoryBudgetResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/budgets',
      headers: ownerHeaders,
      payload: {
        categoryId: incomeCategoryId,
        yearMonth: '2026-04',
        limitAmount: 100_000,
      },
    })
    expect(invalidCategoryBudgetResponse.statusCode).toBe(400)
    const invalidCategoryPayload = invalidCategoryBudgetResponse.json<RespuestaError>()
    expect(invalidCategoryPayload.error.codigo).toBe('PRESUPUESTO_CATEGORIA_INVALIDA')

    const listBudgetsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/budgets?yearMonth=2026-04',
      headers: memberHeaders,
    })
    expect(listBudgetsResponse.statusCode).toBe(200)
    const listPayload = listBudgetsResponse.json<
      RespuestaExitosa<Array<{ id: string; progress: { alertLevel: string } }>>
    >()
    expect(listPayload.exito).toBe(true)
    expect(listPayload.datos.some((budget) => budget.id === createdBudget.id)).toBe(true)

    const updateBudgetResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${createdBudget.id}`,
      headers: ownerHeaders,
      payload: {
        limitAmount: 120_000,
        notes: 'Actualizado',
      },
    })
    expect(updateBudgetResponse.statusCode).toBe(200)
    const updatedPayload = updateBudgetResponse.json<RespuestaExitosa<{ limitAmount: number }>>()
    expect(updatedPayload.datos.limitAmount).toBe(120_000)

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/budgets/summary?yearMonth=2026-04',
      headers: memberHeaders,
    })
    expect(summaryResponse.statusCode).toBe(200)
    const summaryPayload = summaryResponse.json<
      RespuestaExitosa<{ yearMonth: string; totalBudgeted: number }>
    >()
    expect(summaryPayload.exito).toBe(true)
    expect(summaryPayload.datos.yearMonth).toBe('2026-04')
    expect(summaryPayload.datos.totalBudgeted).toBeGreaterThan(0)

    const deleteBudgetResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${createdBudget.id}`,
      headers: ownerHeaders,
    })
    expect(deleteBudgetResponse.statusCode).toBe(200)
  })

  it('emite alertas de presupuesto en transacciones EXPENSE (create y patch)', async () => {
    const owner = await register({
      email: uniqueEmail('budget-alert-owner'),
      password: 'SecurePass123!',
      displayName: 'Budget Alert Owner',
      workspaceName: 'Workspace Alertas',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const headers = {
      authorization: `Bearer ${owner.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }

    const accountResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers,
      payload: {
        name: 'Cuenta alertas',
        type: 'CASH',
      },
    })
    expect(accountResponse.statusCode).toBe(201)
    const accountId = accountResponse.json<RespuestaExitosa<{ id: string }>>().datos.id

    const categoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers,
      payload: {
        name: `Alert category ${randomSuffix()}`,
        type: 'EXPENSE',
      },
    })
    expect(categoryResponse.statusCode).toBe(201)
    const categoryId = categoryResponse.json<RespuestaExitosa<{ id: string }>>().datos.id

    const yearMonth = new Date().toISOString().slice(0, 7)
    const createBudgetResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/budgets',
      headers,
      payload: {
        categoryId,
        yearMonth,
        limitAmount: 100_000,
      },
    })
    expect(createBudgetResponse.statusCode).toBe(201)

    const nowIso = new Date().toISOString()

    const createExpenseNoAlert = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers,
      payload: {
        accountId,
        categoryId,
        type: 'EXPENSE',
        amount: 70_000,
        occurredAt: nowIso,
      },
    })
    expect(createExpenseNoAlert.statusCode).toBe(201)
    const noAlertPayload = createExpenseNoAlert.json<
      RespuestaExitosa<{ id: string; amount: number }>
    >()
    const noAlertMeta = noAlertPayload.meta as Record<string, unknown>
    expect(noAlertMeta.alertasPresupuesto).toBeUndefined()
    const transactionId = noAlertPayload.datos.id

    const patchToWarningResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${transactionId}`,
      headers,
      payload: {
        amount: 85_000,
      },
    })
    expect(patchToWarningResponse.statusCode).toBe(200)
    const warningPayload = patchToWarningResponse.json<
      RespuestaExitosa<{ id: string; amount: number }>
    >()
    const warningMeta = warningPayload.meta as {
      alertasPresupuesto?: Array<{ alertLevel: string; usedPercent: number }>
    }
    expect(warningMeta.alertasPresupuesto?.[0]?.alertLevel).toBe('WARNING')
    expect((warningMeta.alertasPresupuesto?.[0]?.usedPercent ?? 0) >= 80).toBe(true)

    const createExpenseExceededResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers,
      payload: {
        accountId,
        categoryId,
        type: 'EXPENSE',
        amount: 20_000,
        occurredAt: nowIso,
      },
    })
    expect(createExpenseExceededResponse.statusCode).toBe(201)
    const exceededPayload = createExpenseExceededResponse.json<
      RespuestaExitosa<{ id: string; amount: number }>
    >()
    const exceededMeta = exceededPayload.meta as {
      alertasPresupuesto?: Array<{ alertLevel: string; usedPercent: number }>
    }
    expect(exceededMeta.alertasPresupuesto?.[0]?.alertLevel).toBe('EXCEEDED')
    expect((exceededMeta.alertasPresupuesto?.[0]?.usedPercent ?? 0) >= 100).toBe(true)
  })

  it('expone estado de módulos fase 5 y persiste tickets/compras/inventario con datos reales', async () => {
    const owner = await register({
      email: uniqueEmail('phase5-owner'),
      password: 'SecurePass123!',
      displayName: 'Phase5 Owner',
      workspaceName: 'Workspace Phase5',
    })

    const workspaceId = owner.workspaces[0]?.id
    expect(workspaceId).toBeDefined()

    const headers = {
      authorization: `Bearer ${owner.tokens.accessToken}`,
      'x-workspace-id': workspaceId ?? '',
    }

    const initialStatusResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/phase5/status',
      headers,
    })

    expect(initialStatusResponse.statusCode).toBe(200)
    const initialStatusPayload = initialStatusResponse.json<
      RespuestaExitosa<{
        modules: Array<{
          key: string
          status: string
          count: number
        }>
      }>
    >()
    expect(initialStatusPayload.exito).toBe(true)
    expect(initialStatusPayload.datos.modules.length).toBe(3)
    expect(initialStatusPayload.datos.modules.every((module) => module.status === 'READY')).toBe(
      true,
    )

    const accountResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers,
      payload: {
        name: 'Caja Phase5',
        type: 'CASH',
      },
    })
    expect(accountResponse.statusCode).toBe(201)
    const accountId = accountResponse.json<RespuestaExitosa<{ id: string }>>().datos.id
    expect(accountId).toBeDefined()

    const nowIso = new Date().toISOString()
    const transactionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers,
      payload: {
        accountId,
        type: 'EXPENSE',
        amount: 18_500,
        occurredAt: nowIso,
        description: 'Compra para vínculo fase 5',
      },
    })
    expect(transactionResponse.statusCode).toBe(201)
    const linkedTransactionId = transactionResponse.json<RespuestaExitosa<{ id: string }>>().datos.id

    const createTicketResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers,
      payload: {
        title: 'Ticket supermercado',
        amount: 18_500,
        purchasedAt: nowIso,
        merchant: 'Mercado Central',
        category: 'Despensa',
        currency: 'MXN',
        linkedTransactionId,
      },
    })

    expect(createTicketResponse.statusCode).toBe(201)
    const createTicketPayload = createTicketResponse.json<
      RespuestaExitosa<{ id: string; title: string; linkedTransactionId: string | null }>
    >()
    expect(createTicketPayload.exito).toBe(true)
    expect(createTicketPayload.datos.title).toBe('Ticket supermercado')
    expect(createTicketPayload.datos.linkedTransactionId).toBe(linkedTransactionId)

    const listTicketsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/tickets?period=month&search=Mercado',
      headers,
    })
    expect(listTicketsResponse.statusCode).toBe(200)
    const listTicketsPayload = listTicketsResponse.json<
      RespuestaExitosa<Array<{ id: string; title: string }>>
    >()
    expect(listTicketsPayload.exito).toBe(true)
    expect(
      listTicketsPayload.datos.some((ticket) => ticket.id === createTicketPayload.datos.id),
    ).toBe(true)

    const createShoppingItemResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/shopping-items',
      headers,
      payload: {
        name: 'Leche',
        quantity: 2,
        unit: 'pzas',
        estimatedAmount: 120,
        priority: 'HIGH',
        status: 'PENDING',
        linkedTransactionId,
      },
    })
    expect(createShoppingItemResponse.statusCode).toBe(201)
    const createShoppingPayload = createShoppingItemResponse.json<
      RespuestaExitosa<{ id: string; status: 'PENDING' | 'BOUGHT' | 'CANCELED' }>
    >()
    expect(createShoppingPayload.exito).toBe(true)
    expect(createShoppingPayload.datos.status).toBe('PENDING')

    const listShoppingItemsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/shopping-items?status=PENDING&search=Leche',
      headers,
    })
    expect(listShoppingItemsResponse.statusCode).toBe(200)
    const listShoppingPayload = listShoppingItemsResponse.json<
      RespuestaExitosa<Array<{ id: string; name: string }>>
    >()
    expect(listShoppingPayload.exito).toBe(true)
    expect(
      listShoppingPayload.datos.some((item) => item.id === createShoppingPayload.datos.id),
    ).toBe(true)

    const createInventoryItemResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory-items',
      headers,
      payload: {
        name: 'Arroz',
        stock: 3,
        minStock: 5,
        unit: 'kg',
        reorderQty: 4,
      },
    })
    expect(createInventoryItemResponse.statusCode).toBe(201)
    const createInventoryPayload = createInventoryItemResponse.json<
      RespuestaExitosa<{ id: string; name: string }>
    >()
    expect(createInventoryPayload.exito).toBe(true)

    const listInventoryItemsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory-items?lowStockOnly=true&search=Arroz',
      headers,
    })
    expect(listInventoryItemsResponse.statusCode).toBe(200)
    const listInventoryPayload = listInventoryItemsResponse.json<
      RespuestaExitosa<Array<{ id: string; isLowStock: boolean }>>
    >()
    expect(listInventoryPayload.exito).toBe(true)
    expect(
      listInventoryPayload.datos.some(
        (item) => item.id === createInventoryPayload.datos.id && item.isLowStock,
      ),
    ).toBe(true)

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/phase5/status',
      headers,
    })
    expect(statusResponse.statusCode).toBe(200)
    const statusPayload = statusResponse.json<
      RespuestaExitosa<{
        modules: Array<{ key: string; status: string; count: number }>
      }>
    >()
    expect(statusPayload.exito).toBe(true)

    const ticketsModule = statusPayload.datos.modules.find((module) => module.key === 'tickets')
    const shoppingModule = statusPayload.datos.modules.find((module) => module.key === 'shopping')
    const inventoryModule = statusPayload.datos.modules.find((module) => module.key === 'inventory')

    expect(ticketsModule?.status).toBe('READY')
    expect(shoppingModule?.status).toBe('READY')
    expect(inventoryModule?.status).toBe('READY')
    expect((ticketsModule?.count ?? 0) >= 1).toBe(true)
    expect((shoppingModule?.count ?? 0) >= 1).toBe(true)
    expect((inventoryModule?.count ?? 0) >= 1).toBe(true)
  })
})
