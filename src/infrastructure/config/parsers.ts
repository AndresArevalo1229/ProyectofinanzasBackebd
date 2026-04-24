const DEFAULT_CORS_ORIGINS = ['http://localhost:5173']

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off'])

export const parseEncuestaExcludedClientIds = (rawValue: string): number[] => {
  const normalized = rawValue.trim()

  if (normalized.length === 0) {
    return []
  }

  return normalized.split(',').map((value) => {
    const candidate = value.trim()

    if (!/^\d+$/.test(candidate)) {
      throw new Error(`ENCUESTA_EXCLUDED_CLIENT_IDS contiene un valor inválido: ${candidate}`)
    }

    return Number(candidate)
  })
}

export const parseCorsOrigins = (rawValue: string): string[] => {
  const normalized = rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  if (normalized.length === 0) {
    return [...DEFAULT_CORS_ORIGINS]
  }

  return normalized
}

export const parseBooleanFlag = (
  rawValue: string | undefined,
  defaultValue: boolean,
  envName: string,
): boolean => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue
  }

  const normalized = rawValue.trim().toLowerCase()

  if (TRUTHY_VALUES.has(normalized)) {
    return true
  }

  if (FALSY_VALUES.has(normalized)) {
    return false
  }

  throw new Error(
    `${envName} contiene un valor inválido: ${rawValue}. Usa true/false, 1/0, yes/no u on/off.`,
  )
}
