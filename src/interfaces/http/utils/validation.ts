import { ZodError, type ZodType } from 'zod'

import { HttpError } from '../errors/http-error.js'

export const validateWithSchema = <TOutput>(
  schema: ZodType<TOutput>,
  value: unknown,
): TOutput => {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, 'SOLICITUD_INVALIDA', 'Los datos enviados no son válidos', {
        issues: error.issues,
      })
    }

    throw error
  }
}
