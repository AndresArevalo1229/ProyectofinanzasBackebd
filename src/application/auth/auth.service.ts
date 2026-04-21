import type {
  Prisma,
  PrismaClient,
  User,
  Workspace,
  WorkspaceMember,
} from '@prisma/client'

import { DEFAULT_CATEGORIES } from '../shared/constants/default-categories.js'
import { DEFAULT_TRANSACTION_TAGS } from '../shared/constants/default-tags.js'
import type { AppConfig } from '../../infrastructure/config/env.js'
import { generateOpaqueToken, hashToken } from '../../infrastructure/security/hash.js'
import { hashPassword, verifyPassword } from '../../infrastructure/security/password.js'
import { signAccessToken } from '../../infrastructure/security/token.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

interface AuthRequestMetadata {
  ipAddress?: string
  userAgent?: string
}

interface RegisterInput {
  email: string
  password: string
  displayName: string
  workspaceName?: string
  baseCurrency?: string
  timezone?: string
}

interface LoginInput {
  email: string
  password: string
}

interface PasswordForgotInput {
  email: string
}

interface PasswordResetInput {
  token: string
  newPassword: string
}

interface TokenBundle {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: string
}

interface WorkspaceSummary {
  id: string
  name: string
  baseCurrency: string
  timezone: string
  role: 'OWNER' | 'MEMBER'
}

interface AuthUserSummary {
  id: string
  email: string
  displayName: string
}

interface AuthSuccessResult {
  user: AuthUserSummary
  workspaces: WorkspaceSummary[]
  tokens: TokenBundle
}

const normalizeCurrency = (value?: string): string => {
  if (!value) {
    return 'MXN'
  }

  return value.trim().toUpperCase()
}

const normalizeTimezone = (value?: string): string => {
  if (!value) {
    return 'America/Mexico_City'
  }

  return value
}

const getRefreshExpiration = (ttlDays: number): Date => {
  const result = new Date()
  result.setDate(result.getDate() + ttlDays)
  return result
}

const mapWorkspaceSummary = (
  membership: WorkspaceMember & {
    workspace: Workspace
  },
): WorkspaceSummary => {
  return {
    id: membership.workspace.id,
    name: membership.workspace.name,
    baseCurrency: membership.workspace.baseCurrency,
    timezone: membership.workspace.timezone,
    role: membership.role,
  }
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<AppConfig, 'auth'>,
  ) {}

  private async createAuthAuditLog(
    tx: Prisma.TransactionClient,
    params: {
      eventType:
        | 'REGISTER'
        | 'LOGIN'
        | 'LOGIN_FAILED'
        | 'REFRESH'
        | 'LOGOUT'
        | 'PASSWORD_FORGOT'
        | 'PASSWORD_RESET'
      userId?: string
      workspaceId?: string
      metadata?: Prisma.InputJsonValue
      request: AuthRequestMetadata
    },
  ): Promise<void> {
    await tx.authAuditLog.create({
      data: {
        eventType: params.eventType,
        userId: params.userId,
        workspaceId: params.workspaceId,
        metadata: params.metadata,
        ipAddress: params.request.ipAddress,
        userAgent: params.request.userAgent,
      },
    })
  }

  private async issueSessionTokens(
    tx: Prisma.TransactionClient,
    params: {
      user: User
      request: AuthRequestMetadata
      previousSessionId?: string
    },
  ): Promise<TokenBundle> {
    const accessToken = signAccessToken(
      {
        sub: params.user.id,
        email: params.user.email,
      },
      { auth: this.config.auth },
    )

    const refreshToken = generateOpaqueToken(64)

    await tx.refreshSession.create({
      data: {
        userId: params.user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: getRefreshExpiration(this.config.auth.refreshTokenTtlDays),
        userAgent: params.request.userAgent,
        ipAddress: params.request.ipAddress,
        previousSessionId: params.previousSessionId,
      },
    })

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.auth.accessTokenTtl,
    }
  }

  private async loadWorkspaceSummaries(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<WorkspaceSummary[]> {
    const memberships = await tx.workspaceMember.findMany({
      where: {
        userId,
        deletedAt: null,
        workspace: {
          deletedAt: null,
        },
      },
      include: {
        workspace: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    return memberships.map(mapWorkspaceSummary)
  }

  async register(
    input: RegisterInput,
    request: AuthRequestMetadata,
  ): Promise<AuthSuccessResult> {
    const normalizedEmail = input.email.trim().toLowerCase()

    return this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          email: normalizedEmail,
        },
        select: {
          id: true,
        },
      })

      if (existingUser) {
        throw new HttpError(409, 'EMAIL_EN_USO', 'Ya existe un usuario con ese correo')
      }

      const passwordHash = await hashPassword(input.password)

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          displayName: input.displayName.trim(),
        },
      })

      const workspace = await tx.workspace.create({
        data: {
          name: input.workspaceName?.trim() || 'Espacio personal',
          baseCurrency: normalizeCurrency(input.baseCurrency),
          timezone: normalizeTimezone(input.timezone),
          createdByUserId: user.id,
        },
      })

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'OWNER',
        },
      })

      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map((category) => ({
          workspaceId: workspace.id,
          createdByUserId: user.id,
          name: category.name,
          type: category.type,
          color: category.color,
          icon: category.icon,
          isSystem: true,
        })),
      })

      await tx.transactionTag.createMany({
        data: DEFAULT_TRANSACTION_TAGS.map((name) => ({
          workspaceId: workspace.id,
          name,
        })),
      })

      await this.createAuthAuditLog(tx, {
        eventType: 'REGISTER',
        userId: user.id,
        workspaceId: workspace.id,
        request,
      })

      const tokens = await this.issueSessionTokens(tx, {
        user,
        request,
      })

      const workspaces = await this.loadWorkspaceSummaries(tx, user.id)

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        workspaces,
        tokens,
      }
    })
  }

  async login(input: LoginInput, request: AuthRequestMetadata): Promise<AuthSuccessResult> {
    const normalizedEmail = input.email.trim().toLowerCase()

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          email: normalizedEmail,
          deletedAt: null,
        },
      })

      if (!user) {
        await this.createAuthAuditLog(tx, {
          eventType: 'LOGIN_FAILED',
          metadata: {
            email: normalizedEmail,
            reason: 'user_not_found',
          },
          request,
        })

        throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña inválidos')
      }

      const validPassword = await verifyPassword(user.passwordHash, input.password)

      if (!validPassword) {
        await this.createAuthAuditLog(tx, {
          eventType: 'LOGIN_FAILED',
          userId: user.id,
          metadata: {
            email: normalizedEmail,
            reason: 'wrong_password',
          },
          request,
        })

        throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña inválidos')
      }

      const tokens = await this.issueSessionTokens(tx, {
        user,
        request,
      })

      await this.createAuthAuditLog(tx, {
        eventType: 'LOGIN',
        userId: user.id,
        request,
      })

      const workspaces = await this.loadWorkspaceSummaries(tx, user.id)

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        workspaces,
        tokens,
      }
    })
  }

  async refreshSession(
    refreshToken: string,
    request: AuthRequestMetadata,
  ): Promise<{ tokens: TokenBundle; user: AuthUserSummary; workspaces: WorkspaceSummary[] }> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findFirst({
        where: {
          tokenHash: hashToken(refreshToken),
        },
        include: {
          user: true,
        },
      })

      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        throw new HttpError(401, 'REFRESH_TOKEN_INVALIDO', 'No fue posible refrescar la sesión')
      }

      await tx.refreshSession.update({
        where: {
          id: session.id,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: 'rotated',
        },
      })

      const tokens = await this.issueSessionTokens(tx, {
        user: session.user,
        request,
        previousSessionId: session.id,
      })

      await this.createAuthAuditLog(tx, {
        eventType: 'REFRESH',
        userId: session.user.id,
        request,
      })

      const workspaces = await this.loadWorkspaceSummaries(tx, session.user.id)

      return {
        tokens,
        user: {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
        },
        workspaces,
      }
    })
  }

  async logout(refreshToken: string, request: AuthRequestMetadata): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findFirst({
        where: {
          tokenHash: hashToken(refreshToken),
        },
      })

      if (!session) {
        return
      }

      if (!session.revokedAt) {
        await tx.refreshSession.update({
          where: {
            id: session.id,
          },
          data: {
            revokedAt: new Date(),
            revokedReason: 'logout',
          },
        })
      }

      await this.createAuthAuditLog(tx, {
        eventType: 'LOGOUT',
        userId: session.userId,
        request,
      })
    })
  }

  async forgotPassword(
    input: PasswordForgotInput,
    request: AuthRequestMetadata,
  ): Promise<{ resetToken?: string }> {
    const normalizedEmail = input.email.trim().toLowerCase()

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          email: normalizedEmail,
          deletedAt: null,
        },
      })

      if (!user) {
        await this.createAuthAuditLog(tx, {
          eventType: 'PASSWORD_FORGOT',
          metadata: {
            email: normalizedEmail,
            reason: 'user_not_found',
          },
          request,
        })

        return {}
      }

      const rawResetToken = generateOpaqueToken(48)
      const resetTokenHash = hashToken(rawResetToken)

      const expiresAt = new Date()
      expiresAt.setMinutes(
        expiresAt.getMinutes() + this.config.auth.passwordResetTtlMinutes,
      )

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: resetTokenHash,
          expiresAt,
        },
      })

      await this.createAuthAuditLog(tx, {
        eventType: 'PASSWORD_FORGOT',
        userId: user.id,
        request,
      })

      return {
        resetToken: rawResetToken,
      }
    })
  }

  async resetPassword(
    input: PasswordResetInput,
    request: AuthRequestMetadata,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const tokenHash = hashToken(input.token)
      const resetToken = await tx.passwordResetToken.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        include: {
          user: true,
        },
      })

      if (!resetToken) {
        throw new HttpError(
          400,
          'TOKEN_RESET_INVALIDO',
          'El token de recuperación no es válido o expiró',
        )
      }

      const passwordHash = await hashPassword(input.newPassword)

      await tx.user.update({
        where: {
          id: resetToken.userId,
        },
        data: {
          passwordHash,
        },
      })

      await tx.passwordResetToken.update({
        where: {
          id: resetToken.id,
        },
        data: {
          usedAt: new Date(),
        },
      })

      await tx.refreshSession.updateMany({
        where: {
          userId: resetToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: 'password_reset',
        },
      })

      await this.createAuthAuditLog(tx, {
        eventType: 'PASSWORD_RESET',
        userId: resetToken.userId,
        request,
      })
    })
  }
}
