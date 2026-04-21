const DEFAULT_CORS_ORIGINS = ['http://localhost:5173']

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
