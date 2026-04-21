import type { Prisma, PrismaClient, WorkspaceRole } from '@prisma/client'

import { DEFAULT_CATEGORIES } from '../shared/constants/default-categories.js'
import { DEFAULT_TRANSACTION_TAGS } from '../shared/constants/default-tags.js'
import type { AppConfig } from '../../infrastructure/config/env.js'
import { generateOpaqueToken } from '../../infrastructure/security/hash.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

interface CreateWorkspaceInput {
  name: string
  baseCurrency?: string
  timezone?: string
}

interface UpdateWorkspaceSettingsInput {
  name?: string
  baseCurrency?: string
  timezone?: string
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

const inviteCode = (): string => {
  return generateOpaqueToken(18).replace(/[-_]/g, '').slice(0, 18).toUpperCase()
}

export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<AppConfig, 'workspace'>,
  ) {}

  private async seedDefaultCategories(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({
        workspaceId,
        createdByUserId: userId,
        name: category.name,
        type: category.type,
        color: category.color,
        icon: category.icon,
        isSystem: true,
      })),
    })
  }

  private async seedDefaultTags(
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<void> {
    await tx.transactionTag.createMany({
      data: DEFAULT_TRANSACTION_TAGS.map((name) => ({
        workspaceId,
        name,
      })),
    })
  }

  async createWorkspace(
    userId: string,
    input: CreateWorkspaceInput,
  ): Promise<{ id: string; name: string; baseCurrency: string; timezone: string }> {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          baseCurrency: normalizeCurrency(input.baseCurrency),
          timezone: normalizeTimezone(input.timezone),
          createdByUserId: userId,
        },
      })

      await tx.workspaceMember.create({
        data: {
          userId,
          workspaceId: workspace.id,
          role: 'OWNER',
        },
      })

      await this.seedDefaultCategories(tx, workspace.id, userId)
      await this.seedDefaultTags(tx, workspace.id)

      return {
        id: workspace.id,
        name: workspace.name,
        baseCurrency: workspace.baseCurrency,
        timezone: workspace.timezone,
      }
    })
  }

  async listWorkspacesByUser(userId: string): Promise<
    Array<{
      id: string
      name: string
      baseCurrency: string
      timezone: string
      role: WorkspaceRole
      membersCount: number
    }>
  > {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        userId,
        deletedAt: null,
        workspace: {
          deletedAt: null,
        },
      },
      include: {
        workspace: {
          include: {
            _count: {
              select: {
                memberships: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
    })

    return memberships.map((membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
      baseCurrency: membership.workspace.baseCurrency,
      timezone: membership.workspace.timezone,
      role: membership.role,
      membersCount: membership.workspace._count.memberships,
    }))
  }

  async createInvite(
    workspaceId: string,
    createdByUserId: string,
  ): Promise<{ code: string; expiresAt: Date; workspaceId: string }> {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + this.config.workspace.inviteTtlDays)

    const invite = await this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        code: inviteCode(),
        status: 'PENDING',
        expiresAt,
        createdByUserId,
      },
      select: {
        workspaceId: true,
        code: true,
        expiresAt: true,
      },
    })

    return invite
  }

  async joinWorkspaceByInvite(
    userId: string,
    code: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole }> {
    const normalizedCode = code.trim().toUpperCase()

    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.workspaceInvite.findFirst({
        where: {
          code: normalizedCode,
          status: 'PENDING',
          deletedAt: null,
          expiresAt: {
            gt: new Date(),
          },
          workspace: {
            deletedAt: null,
          },
        },
      })

      if (!invite) {
        throw new HttpError(404, 'INVITACION_INVALIDA', 'La invitación no existe o expiró')
      }

      const existingMembership = await tx.workspaceMember.findFirst({
        where: {
          workspaceId: invite.workspaceId,
          userId,
          deletedAt: null,
        },
      })

      if (!existingMembership) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId,
            role: 'MEMBER',
          },
        })
      }

      await tx.workspaceInvite.update({
        where: {
          id: invite.id,
        },
        data: {
          status: 'ACCEPTED',
          acceptedByUserId: userId,
          acceptedAt: new Date(),
        },
      })

      return {
        workspaceId: invite.workspaceId,
        role: existingMembership?.role ?? 'MEMBER',
      }
    })
  }

  async listMembers(workspaceId: string): Promise<
    Array<{
      userId: string
      displayName: string
      email: string
      role: WorkspaceRole
      joinedAt: Date
    }>
  > {
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        deletedAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    })

    return members.map((member) => ({
      userId: member.user.id,
      displayName: member.user.displayName,
      email: member.user.email,
      role: member.role,
      joinedAt: member.joinedAt,
    }))
  }

  async removeMember(
    workspaceId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const targetMember = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: targetUserId,
        deletedAt: null,
      },
      include: {
        workspace: {
          select: {
            createdByUserId: true,
          },
        },
      },
    })

    if (!targetMember) {
      throw new HttpError(404, 'MIEMBRO_NO_ENCONTRADO', 'El miembro no existe')
    }

    if (targetMember.role === 'OWNER') {
      throw new HttpError(
        400,
        'NO_SE_PUEDE_REMOVER_OWNER',
        'No se puede remover al owner del workspace',
      )
    }

    if (targetMember.userId === actorUserId) {
      throw new HttpError(400, 'ACCION_INVALIDA', 'No puedes removerte a ti mismo')
    }

    await this.prisma.workspaceMember.update({
      where: {
        id: targetMember.id,
      },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  async updateWorkspaceSettings(
    workspaceId: string,
    input: UpdateWorkspaceSettingsInput,
  ): Promise<{ id: string; name: string; baseCurrency: string; timezone: string }> {
    const workspace = await this.prisma.workspace.update({
      where: {
        id: workspaceId,
      },
      data: {
        name: input.name?.trim(),
        baseCurrency: input.baseCurrency ? normalizeCurrency(input.baseCurrency) : undefined,
        timezone: input.timezone ? normalizeTimezone(input.timezone) : undefined,
      },
      select: {
        id: true,
        name: true,
        baseCurrency: true,
        timezone: true,
      },
    })

    return workspace
  }
}
