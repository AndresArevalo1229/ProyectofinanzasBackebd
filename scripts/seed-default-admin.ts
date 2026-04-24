import { z } from 'zod'
import { pathToFileURL } from 'node:url'

import { DEFAULT_CATEGORIES } from '../src/application/shared/constants/default-categories.js'
import { DEFAULT_TRANSACTION_TAGS } from '../src/application/shared/constants/default-tags.js'
import { loadEnvironment } from '../src/infrastructure/config/env.js'
import { createPrismaClient } from '../src/infrastructure/database/prisma/prisma-client.js'
import { hashPassword } from '../src/infrastructure/security/password.js'

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: z.string().email().default('admin@misfinanzas.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin12345!'),
  SEED_ADMIN_DISPLAY_NAME: z.string().min(2).default('Administrador'),
  SEED_ADMIN_WORKSPACE_NAME: z.string().min(2).default('Espacio personal admin'),
  SEED_ADMIN_BASE_CURRENCY: z.string().length(3).default('MXN'),
  SEED_ADMIN_TIMEZONE: z.string().min(3).default('America/Mexico_City'),
  SEED_RESET_CONFIRM: z.string().optional(),
})

export const SEED_RESET_CONFIRM_PHRASE = 'YES_RESET_ADMIN'

export interface SeedCliOptions {
  reset: boolean
  confirmReset: string | null
}

export interface ResetMembershipCheck {
  workspaceId: string
  role: 'OWNER' | 'MEMBER'
  workspaceCreatedByUserId: string
  otherActiveMembers: number
}

const readConfirmValueFromArgs = (args: string[]): string | null => {
  const explicit = args.find((arg) => arg.startsWith('--confirm='))
  if (explicit) {
    const value = explicit.slice('--confirm='.length).trim()
    return value.length > 0 ? value : null
  }

  const index = args.findIndex((arg) => arg === '--confirm')
  if (index < 0) {
    return null
  }

  const maybeValue = args[index + 1]
  if (!maybeValue) {
    return null
  }

  const normalized = maybeValue.trim()
  return normalized.length > 0 ? normalized : null
}

export const parseSeedCliOptions = (
  args: string[],
  envConfirmReset: string | undefined,
): SeedCliOptions => {
  const reset = args.includes('--reset')
  const confirmFromArg = readConfirmValueFromArgs(args)
  const confirmReset = confirmFromArg ?? envConfirmReset?.trim() ?? null

  if (reset && confirmReset !== SEED_RESET_CONFIRM_PHRASE) {
    throw new Error(
      `Reset bloqueado: debes confirmar con --confirm ${SEED_RESET_CONFIRM_PHRASE} (o SEED_RESET_CONFIRM=${SEED_RESET_CONFIRM_PHRASE}).`,
    )
  }

  return {
    reset,
    confirmReset,
  }
}

export const assertResetSafety = (
  userId: string,
  memberships: ResetMembershipCheck[],
): string[] => {
  if (memberships.length === 0) {
    return []
  }

  const hasCrossMembership = memberships.some((membership) => {
    return (
      membership.role !== 'OWNER' ||
      membership.workspaceCreatedByUserId !== userId
    )
  })

  if (hasCrossMembership) {
    throw new Error(
      'Reset inseguro: el admin tiene membresías cruzadas o no-owner. Limpia esas membresías antes de continuar.',
    )
  }

  const blockedWorkspace = memberships.find((membership) => {
    return membership.otherActiveMembers > 0
  })

  if (blockedWorkspace) {
    throw new Error(
      `Reset inseguro: el workspace ${blockedWorkspace.workspaceId} tiene otros miembros activos.`,
    )
  }

  return [...new Set(memberships.map((membership) => membership.workspaceId))]
}

const createSeedAdmin = async (
  prisma: ReturnType<typeof createPrismaClient>,
  seedConfig: z.infer<typeof seedEnvSchema>,
) => {
  const email = seedConfig.SEED_ADMIN_EMAIL.trim().toLowerCase()
  const passwordHash = await hashPassword(seedConfig.SEED_ADMIN_PASSWORD)

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName: seedConfig.SEED_ADMIN_DISPLAY_NAME.trim(),
      },
    })

    const workspace = await tx.workspace.create({
      data: {
        name: seedConfig.SEED_ADMIN_WORKSPACE_NAME.trim(),
        baseCurrency: seedConfig.SEED_ADMIN_BASE_CURRENCY.trim().toUpperCase(),
        timezone: seedConfig.SEED_ADMIN_TIMEZONE.trim(),
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

    return {
      userId: user.id,
      workspaceId: workspace.id,
    }
  })
}

const resetAdminData = async (
  prisma: ReturnType<typeof createPrismaClient>,
  userId: string,
  workspaceIds: string[],
) => {
  if (workspaceIds.length === 0) {
    await prisma.$transaction(async (tx) => {
      await tx.refreshSession.deleteMany({ where: { userId } })
      await tx.passwordResetToken.deleteMany({ where: { userId } })
      await tx.authAuditLog.deleteMany({ where: { userId } })
      await tx.workspaceInvite.deleteMany({
        where: {
          OR: [{ createdByUserId: userId }, { acceptedByUserId: userId }],
        },
      })
      await tx.workspaceMember.deleteMany({ where: { userId } })
      await tx.user.delete({ where: { id: userId } })
    })

    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.goalContribution.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.accountTransfer.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.ticket.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.shoppingItem.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.inventoryItem.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.budget.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.transaction.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.goal.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.transactionTag.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.category.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.account.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    })
    await tx.authAuditLog.deleteMany({
      where: {
        OR: [{ workspaceId: { in: workspaceIds } }, { userId }],
      },
    })
    await tx.workspaceInvite.deleteMany({
      where: {
        OR: [
          { workspaceId: { in: workspaceIds } },
          { createdByUserId: userId },
          { acceptedByUserId: userId },
        ],
      },
    })
    await tx.workspaceMember.deleteMany({
      where: {
        OR: [{ workspaceId: { in: workspaceIds } }, { userId }],
      },
    })
    await tx.workspace.deleteMany({
      where: { id: { in: workspaceIds } },
    })

    await tx.refreshSession.deleteMany({ where: { userId } })
    await tx.passwordResetToken.deleteMany({ where: { userId } })
    await tx.authAuditLog.deleteMany({ where: { userId } })
    await tx.workspaceInvite.deleteMany({
      where: {
        OR: [{ createdByUserId: userId }, { acceptedByUserId: userId }],
      },
    })
    await tx.workspaceMember.deleteMany({ where: { userId } })
    await tx.user.delete({ where: { id: userId } })
  })
}

export const runSeedDefaultAdmin = async (
  args: string[] = process.argv.slice(2),
): Promise<void> => {
  const appConfig = loadEnvironment()
  const seedConfig = seedEnvSchema.parse(process.env)
  const cliOptions = parseSeedCliOptions(args, seedConfig.SEED_RESET_CONFIRM)

  const prisma = createPrismaClient(appConfig)
  await prisma.$connect()

  try {
    const email = seedConfig.SEED_ADMIN_EMAIL.trim().toLowerCase()

    const existingUser = await prisma.user.findFirst({
      where: {
        email,
      },
      select: {
        id: true,
        deletedAt: true,
      },
    })

    if (existingUser?.deletedAt) {
      throw new Error(
        `Existe un usuario eliminado con el correo ${email}. Recupera o elimina ese registro antes de seedear.`,
      )
    }

    if (!existingUser) {
      const created = await createSeedAdmin(prisma, seedConfig)
      console.info('Seed admin creado correctamente.')
      console.info(`email: ${seedConfig.SEED_ADMIN_EMAIL}`)
      console.info(`userId: ${created.userId}`)
      console.info(`workspaceId: ${created.workspaceId}`)
      return
    }

    if (!cliOptions.reset) {
      console.info(`Seed omitido: el usuario admin ya existe (${email}).`)
      return
    }

    const memberships = await prisma.workspaceMember.findMany({
      where: {
        userId: existingUser.id,
        deletedAt: null,
      },
      select: {
        workspaceId: true,
        role: true,
        workspace: {
          select: {
            createdByUserId: true,
            memberships: {
              where: {
                deletedAt: null,
                userId: {
                  not: existingUser.id,
                },
              },
              select: {
                id: true,
              },
            },
          },
        },
      },
    })

    const membershipChecks: ResetMembershipCheck[] = memberships.map((membership) => ({
      workspaceId: membership.workspaceId,
      role: membership.role,
      workspaceCreatedByUserId: membership.workspace.createdByUserId,
      otherActiveMembers: membership.workspace.memberships.length,
    }))

    const workspaceIds = assertResetSafety(existingUser.id, membershipChecks)
    await resetAdminData(prisma, existingUser.id, workspaceIds)

    const created = await createSeedAdmin(prisma, seedConfig)
    console.info('Reset admin completado correctamente.')
    console.info(`email: ${seedConfig.SEED_ADMIN_EMAIL}`)
    console.info(`userId: ${created.userId}`)
    console.info(`workspaceId: ${created.workspaceId}`)
  } finally {
    await prisma.$disconnect()
  }
}

const isMainModule = (): boolean => {
  const currentArgvPath = process.argv[1]
  if (!currentArgvPath) {
    return false
  }

  return import.meta.url === pathToFileURL(currentArgvPath).href
}

if (isMainModule()) {
  runSeedDefaultAdmin().catch((error: unknown) => {
    console.error('Error ejecutando seed default admin:', error)
    process.exit(1)
  })
}
