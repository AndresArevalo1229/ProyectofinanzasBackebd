import { config as loadDotEnv } from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { loadEnvironment } from '../src/infrastructure/config/env.js'
import { createPrismaClient } from '../src/infrastructure/database/prisma/prisma-client.js'

const CONFIRM_PHRASE = 'YES_DELETE_TEST_DATA'

const cleanupConfigSchema = z.object({
  CLEANUP_CONFIRM: z.string().optional(),
  CLEANUP_DRY_RUN: z.enum(['true', 'false']).default('true'),
  CLEANUP_EMAIL_REGEX: z.string().default('(test|demo|qa|sample|example|misfinanzas\\.local)'),
  CLEANUP_DISPLAY_NAME_REGEX: z.string().default('(test|demo|qa|sample|seed)'),
  CLEANUP_WORKSPACE_REGEX: z.string().default('(test|demo|qa|sample|sandbox|seed)'),
  CLEANUP_EXCLUDE_EMAILS: z.string().optional(),
  CLEANUP_BACKUP_DIR: z.string().default('backups/cleanup'),
})

const escapeBackupTimestamp = (value: Date): string => {
  return value.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

const toCaseInsensitiveRegex = (pattern: string): RegExp => {
  return new RegExp(pattern, 'i')
}

const run = async (): Promise<void> => {
  loadDotEnv()

  const appConfig = loadEnvironment()
  const cleanupConfig = cleanupConfigSchema.parse(process.env)
  const prisma = createPrismaClient(appConfig)

  await prisma.$connect()

  try {
    const emailRegex = toCaseInsensitiveRegex(cleanupConfig.CLEANUP_EMAIL_REGEX)
    const displayNameRegex = toCaseInsensitiveRegex(cleanupConfig.CLEANUP_DISPLAY_NAME_REGEX)
    const workspaceRegex = toCaseInsensitiveRegex(cleanupConfig.CLEANUP_WORKSPACE_REGEX)
    const excludedEmails = new Set(
      (cleanupConfig.CLEANUP_EXCLUDE_EMAILS ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    )

    const [users, workspaces] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      }),
      prisma.workspace.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          createdByUserId: true,
        },
      }),
    ])

    const candidateUserIds = new Set(
      users
        .filter((user) => {
          const email = user.email.toLowerCase()
          if (excludedEmails.has(email)) {
            return false
          }

          return emailRegex.test(email) || displayNameRegex.test(user.displayName)
        })
        .map((user) => user.id),
    )

    const candidateWorkspaceIds = new Set(
      workspaces
        .filter((workspace) => {
          if (workspaceRegex.test(workspace.name)) {
            return true
          }

          return candidateUserIds.has(workspace.createdByUserId)
        })
        .map((workspace) => workspace.id),
    )

    const userIds = [...candidateUserIds]
    const workspaceIds = [...candidateWorkspaceIds]

    if (userIds.length === 0 && workspaceIds.length === 0) {
      console.info('No se encontraron usuarios/workspaces de prueba con los patrones configurados.')
      return
    }

    const [backupUsers, backupWorkspaces, backupWorkspaceMembers, backupWorkspaceInvites] =
      await Promise.all([
        prisma.user.findMany({
          where: {
            id: {
              in: userIds,
            },
          },
        }),
        prisma.workspace.findMany({
          where: {
            id: {
              in: workspaceIds,
            },
          },
        }),
        prisma.workspaceMember.findMany({
          where: {
            OR: [
              {
                workspaceId: {
                  in: workspaceIds,
                },
              },
              {
                userId: {
                  in: userIds,
                },
              },
            ],
          },
        }),
        prisma.workspaceInvite.findMany({
          where: {
            workspaceId: {
              in: workspaceIds,
            },
          },
        }),
      ])

    const [
      backupAccounts,
      backupCategories,
      backupTransactionTags,
      backupTransactions,
      backupTransfers,
      backupBudgets,
      backupGoals,
      backupGoalContributions,
      backupTickets,
      backupShoppingItems,
      backupInventoryItems,
      backupAuthAuditLogs,
      backupRefreshSessions,
      backupPasswordResetTokens,
    ] = await Promise.all([
      prisma.account.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.category.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.transactionTag.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.transaction.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.accountTransfer.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.budget.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.goal.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.goalContribution.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.ticket.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.shoppingItem.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.inventoryItem.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.authAuditLog.findMany({
        where: {
          OR: [
            {
              workspaceId: {
                in: workspaceIds,
              },
            },
            {
              userId: {
                in: userIds,
              },
            },
          ],
        },
      }),
      prisma.refreshSession.findMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      }),
      prisma.passwordResetToken.findMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      }),
    ])

    const backupTimestamp = new Date()
    const backupDir = path.resolve(process.cwd(), cleanupConfig.CLEANUP_BACKUP_DIR)
    await mkdir(backupDir, { recursive: true })

    const backupPath = path.join(
      backupDir,
      `cleanup-backup-${escapeBackupTimestamp(backupTimestamp)}.json`,
    )

    const backupPayload = {
      metadata: {
        generatedAt: backupTimestamp.toISOString(),
        userIds,
        workspaceIds,
        emailRegex: cleanupConfig.CLEANUP_EMAIL_REGEX,
        displayNameRegex: cleanupConfig.CLEANUP_DISPLAY_NAME_REGEX,
        workspaceRegex: cleanupConfig.CLEANUP_WORKSPACE_REGEX,
        dryRun: cleanupConfig.CLEANUP_DRY_RUN === 'true',
      },
      data: {
        users: backupUsers,
        workspaces: backupWorkspaces,
        workspaceMembers: backupWorkspaceMembers,
        workspaceInvites: backupWorkspaceInvites,
        accounts: backupAccounts,
        categories: backupCategories,
        transactionTags: backupTransactionTags,
        transactions: backupTransactions,
        accountTransfers: backupTransfers,
        budgets: backupBudgets,
        goals: backupGoals,
        goalContributions: backupGoalContributions,
        tickets: backupTickets,
        shoppingItems: backupShoppingItems,
        inventoryItems: backupInventoryItems,
        authAuditLogs: backupAuthAuditLogs,
        refreshSessions: backupRefreshSessions,
        passwordResetTokens: backupPasswordResetTokens,
      },
    }

    await writeFile(backupPath, JSON.stringify(backupPayload, null, 2), 'utf-8')

    console.info('Resumen pre-limpieza:')
    console.info(`- users objetivo: ${userIds.length}`)
    console.info(`- workspaces objetivo: ${workspaceIds.length}`)
    console.info(`- respaldo generado: ${backupPath}`)

    const dryRun = cleanupConfig.CLEANUP_DRY_RUN === 'true'
    if (dryRun) {
      console.info('Modo DRY RUN activo. No se aplicaron cambios.')
      console.info('Para ejecutar de verdad: CLEANUP_DRY_RUN=false CLEANUP_CONFIRM=YES_DELETE_TEST_DATA')
      return
    }

    if (cleanupConfig.CLEANUP_CONFIRM !== CONFIRM_PHRASE) {
      console.info('Limpieza cancelada. Falta confirmación explícita.')
      console.info(`Define CLEANUP_CONFIRM=${CONFIRM_PHRASE} para proceder.`)
      return
    }

    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const refreshSessions = await tx.refreshSession.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      })

      const passwordResetTokens = await tx.passwordResetToken.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      })

      const authAuditLogs = await tx.authAuditLog.deleteMany({
        where: {
          OR: [
            {
              workspaceId: {
                in: workspaceIds,
              },
            },
            {
              userId: {
                in: userIds,
              },
            },
          ],
        },
      })

      const workspaceInvites = await tx.workspaceInvite.updateMany({
        where: {
          workspaceId: {
            in: workspaceIds,
          },
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          status: 'REVOKED',
        },
      })

      const workspaceMembers = await tx.workspaceMember.updateMany({
        where: {
          OR: [
            {
              workspaceId: {
                in: workspaceIds,
              },
            },
            {
              userId: {
                in: userIds,
              },
            },
          ],
          deletedAt: null,
        },
        data: {
          deletedAt: now,
        },
      })

      const accounts = await tx.account.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const categories = await tx.category.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const transactionTags = await tx.transactionTag.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const transactions = await tx.transaction.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const accountTransfers = await tx.accountTransfer.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const budgets = await tx.budget.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const goals = await tx.goal.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const goalContributions = await tx.goalContribution.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const tickets = await tx.ticket.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const shoppingItems = await tx.shoppingItem.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const inventoryItems = await tx.inventoryItem.updateMany({
        where: { workspaceId: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const workspaces = await tx.workspace.updateMany({
        where: { id: { in: workspaceIds }, deletedAt: null },
        data: { deletedAt: now },
      })
      const users = await tx.user.updateMany({
        where: { id: { in: userIds }, deletedAt: null },
        data: { deletedAt: now },
      })

      return {
        refreshSessions: refreshSessions.count,
        passwordResetTokens: passwordResetTokens.count,
        authAuditLogs: authAuditLogs.count,
        workspaceInvites: workspaceInvites.count,
        workspaceMembers: workspaceMembers.count,
        accounts: accounts.count,
        categories: categories.count,
        transactionTags: transactionTags.count,
        transactions: transactions.count,
        accountTransfers: accountTransfers.count,
        budgets: budgets.count,
        goals: goals.count,
        goalContributions: goalContributions.count,
        tickets: tickets.count,
        shoppingItems: shoppingItems.count,
        inventoryItems: inventoryItems.count,
        workspaces: workspaces.count,
        users: users.count,
      }
    })

    console.info('Limpieza completada.')
    console.info(JSON.stringify(result, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

run().catch((error: unknown) => {
  console.error('Error ejecutando cleanup de datos de prueba:', error)
  process.exit(1)
})
