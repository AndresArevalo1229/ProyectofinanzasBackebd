import type { AuthenticatedUser, WorkspaceContext } from './context.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser
    workspaceContext?: WorkspaceContext
  }
}
