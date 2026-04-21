import type { FastifyRequest } from 'fastify'

const resolveHeaderString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

export const getRequestMetadata = (request: FastifyRequest): {
  ipAddress?: string
  userAgent?: string
} => {
  return {
    ipAddress: request.ip,
    userAgent: resolveHeaderString(request.headers['user-agent']),
  }
}
