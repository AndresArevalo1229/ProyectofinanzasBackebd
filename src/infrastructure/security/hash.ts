import { createHash, randomBytes } from 'node:crypto'

export const hashToken = (raw: string): string => {
  return createHash('sha256').update(raw).digest('hex')
}

export const generateOpaqueToken = (size = 48): string => {
  return randomBytes(size).toString('base64url')
}
