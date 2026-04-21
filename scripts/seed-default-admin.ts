import { z } from 'zod'

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
})

const run = async (): Promise<void> => {
  const appConfig = loadEnvironment()
  const seedConfig = seedEnvSchema.parse(process.env)

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

    if (existingUser && !existingUser.deletedAt) {
      console.info(`Seed omitido: el usuario admin ya existe (${email}).`)
      return
    }

    if (existingUser?.deletedAt) {
      throw new Error(
        `Existe un usuario eliminado con el correo ${email}. Recupera o elimina ese registro antes de seedear.`,
      )
    }

    const passwordHash = await hashPassword(seedConfig.SEED_ADMIN_PASSWORD)

    const created = await prisma.$transaction(async (tx) => {
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

    console.info('Seed admin creado correctamente.')
    console.info(`email: ${seedConfig.SEED_ADMIN_EMAIL}`)
    console.info(`userId: ${created.userId}`)
    console.info(`workspaceId: ${created.workspaceId}`)
  } finally {
    await prisma.$disconnect()
  }
}

run().catch((error: unknown) => {
  console.error('Error ejecutando seed default admin:', error)
  process.exit(1)
})
