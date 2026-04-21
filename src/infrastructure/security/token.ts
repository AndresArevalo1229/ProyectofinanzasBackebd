import jwt, { type SignOptions } from 'jsonwebtoken'

import type { AppConfig } from '../config/env.js'

export interface AccessTokenPayload {
  sub: string
  email: string
}

export const signAccessToken = (
  payload: AccessTokenPayload,
  config: Pick<AppConfig, 'auth'>,
): string => {
  const signOptions: SignOptions = {
    algorithm: 'HS256',
    expiresIn: config.auth.accessTokenTtl as SignOptions['expiresIn'],
  }

  return jwt.sign(payload, config.auth.accessTokenSecret, {
    ...signOptions,
  })
}

export const verifyAccessToken = (
  token: string,
  config: Pick<AppConfig, 'auth'>,
): AccessTokenPayload => {
  const payload = jwt.verify(token, config.auth.accessTokenSecret, {
    algorithms: ['HS256'],
  })

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Token inválido')
  }

  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Token inválido')
  }

  return {
    sub: payload.sub,
    email: payload.email,
  }
}
