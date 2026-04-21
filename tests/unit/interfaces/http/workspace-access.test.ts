import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

import type { HttpError } from '../../../../src/interfaces/http/errors/http-error.js'
import { assertWorkspaceAccess } from '../../../../src/interfaces/http/utils/workspace-access.js'

const createPrismaMock = (
  membership:
    | {
        role: 'OWNER' | 'MEMBER'
        workspace: {
          id: string
          timezone: string
          baseCurrency: string
        }
      }
    | null,
) => {
  return {
    workspaceMember: {
      findFirst: vi.fn().mockResolvedValue(membership),
    },
  } as unknown as PrismaClient
}

describe('assertWorkspaceAccess', () => {
  it('permite acceso owner cuando ownerOnly=true', async () => {
    const prisma = createPrismaMock({
      role: 'OWNER',
      workspace: {
        id: 'ws-1',
        timezone: 'America/Mexico_City',
        baseCurrency: 'MXN',
      },
    })

    const result = await assertWorkspaceAccess(prisma, {
      workspaceId: 'ws-1',
      userId: 'user-1',
      ownerOnly: true,
    })

    expect(result.workspaceId).toBe('ws-1')
    expect(result.role).toBe('OWNER')
  })

  it('rechaza MEMBER cuando ownerOnly=true', async () => {
    const prisma = createPrismaMock({
      role: 'MEMBER',
      workspace: {
        id: 'ws-1',
        timezone: 'America/Mexico_City',
        baseCurrency: 'MXN',
      },
    })

    await expect(
      assertWorkspaceAccess(prisma, {
        workspaceId: 'ws-1',
        userId: 'user-2',
        ownerOnly: true,
      }),
    ).rejects.toEqual(
      expect.objectContaining<HttpError>({
        statusCode: 403,
        codigo: 'PERMISO_DENEGADO',
      }),
    )
  })
})
