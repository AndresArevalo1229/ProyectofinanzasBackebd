import { describe, expect, it } from 'vitest'

import {
  parseBooleanFlag,
  parseCorsOrigins,
  parseEncuestaExcludedClientIds,
} from '../../../../src/infrastructure/config/parsers.js'

describe('parseEncuestaExcludedClientIds', () => {
  it('convierte una lista separada por comas a números', () => {
    expect(parseEncuestaExcludedClientIds('1907, 20, 300')).toEqual([1907, 20, 300])
  })

  it('retorna arreglo vacío cuando no hay IDs', () => {
    expect(parseEncuestaExcludedClientIds('')).toEqual([])
    expect(parseEncuestaExcludedClientIds('   ')).toEqual([])
  })

  it('lanza error cuando encuentra valores no numéricos', () => {
    expect(() => parseEncuestaExcludedClientIds('1907,abc')).toThrow(
      'ENCUESTA_EXCLUDED_CLIENT_IDS contiene un valor inválido: abc',
    )
  })
})

describe('parseCorsOrigins', () => {
  it('normaliza múltiples orígenes separados por comas', () => {
    expect(parseCorsOrigins('http://localhost:5173, https://app.local')).toEqual([
      'http://localhost:5173',
      'https://app.local',
    ])
  })

  it('retorna el origen por defecto cuando la entrada está vacía', () => {
    expect(parseCorsOrigins('')).toEqual(['http://localhost:5173'])
    expect(parseCorsOrigins(' , , ')).toEqual(['http://localhost:5173'])
  })
})

describe('parseBooleanFlag', () => {
  it('retorna default cuando no hay valor', () => {
    expect(parseBooleanFlag(undefined, true, 'FEATURE_X')).toBe(true)
    expect(parseBooleanFlag('', false, 'FEATURE_X')).toBe(false)
    expect(parseBooleanFlag('   ', true, 'FEATURE_X')).toBe(true)
  })

  it('acepta variantes true/false', () => {
    expect(parseBooleanFlag('true', false, 'FEATURE_X')).toBe(true)
    expect(parseBooleanFlag('1', false, 'FEATURE_X')).toBe(true)
    expect(parseBooleanFlag('yes', false, 'FEATURE_X')).toBe(true)
    expect(parseBooleanFlag('on', false, 'FEATURE_X')).toBe(true)
    expect(parseBooleanFlag('false', true, 'FEATURE_X')).toBe(false)
    expect(parseBooleanFlag('0', true, 'FEATURE_X')).toBe(false)
    expect(parseBooleanFlag('no', true, 'FEATURE_X')).toBe(false)
    expect(parseBooleanFlag('off', true, 'FEATURE_X')).toBe(false)
  })

  it('falla cuando el valor es inválido', () => {
    expect(() => parseBooleanFlag('talvez', false, 'FEATURE_X')).toThrow(
      'FEATURE_X contiene un valor inválido',
    )
  })
})
