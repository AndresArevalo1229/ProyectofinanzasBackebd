import type { WorkspaceRole } from '@prisma/client'

export interface AuthenticatedUser {
  id: string
  email: string
  displayName: string
}

export interface WorkspaceContext {
  workspaceId: string
  role: WorkspaceRole
  timezone: string
  baseCurrency: string
}
