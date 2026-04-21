import argon2 from 'argon2'

export const hashPassword = async (plainPassword: string): Promise<string> => {
  return argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
}

export const verifyPassword = async (
  passwordHash: string,
  plainPassword: string,
): Promise<boolean> => {
  return argon2.verify(passwordHash, plainPassword)
}
