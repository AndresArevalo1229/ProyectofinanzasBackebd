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
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? '40',
    RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
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
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

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
})
