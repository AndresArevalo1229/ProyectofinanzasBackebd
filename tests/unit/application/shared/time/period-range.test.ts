import { describe, expect, it } from 'vitest'

import type { HttpError } from '../../../../../src/interfaces/http/errors/http-error.js'
import { resolvePeriodRange } from '../../../../../src/application/shared/time/period-range.js'

describe('resolvePeriodRange', () => {
  it('falla con HttpError 400 cuando custom no recibe from/to', () => {
    expect(() =>
      resolvePeriodRange({
        timezone: 'America/Mexico_City',
        period: 'custom',
        from: '2026-04-01T00:00:00.000Z',
      }),
    ).toThrow(
      expect.objectContaining<HttpError>({
        statusCode: 400,
        codigo: 'PERIODO_INVALIDO',
      }),
    )
  })

  it('falla con HttpError 400 cuando la fecha no es válida', () => {
    expect(() =>
      resolvePeriodRange({
        timezone: 'America/Mexico_City',
        period: 'custom',
        from: 'fecha-no-valida',
        to: '2026-04-20T23:59:59.000Z',
      }),
    ).toThrow(
      expect.objectContaining<HttpError>({
        statusCode: 400,
        codigo: 'PERIODO_INVALIDO',
      }),
    )
  })

  it('falla con HttpError 400 cuando from > to', () => {
    expect(() =>
      resolvePeriodRange({
        timezone: 'America/Mexico_City',
        period: 'custom',
        from: '2026-05-20T23:59:59.000Z',
        to: '2026-04-01T00:00:00.000Z',
      }),
    ).toThrow(
      expect.objectContaining<HttpError>({
        statusCode: 400,
        codigo: 'PERIODO_INVALIDO',
      }),
    )
  })

  it('falla con HttpError 400 cuando anchorDate es inválida', () => {
    expect(() =>
      resolvePeriodRange({
        timezone: 'America/Mexico_City',
        period: 'month',
        anchorDate: 'no-fecha',
      }),
    ).toThrow(
      expect.objectContaining<HttpError>({
        statusCode: 400,
        codigo: 'PERIODO_INVALIDO',
      }),
    )
  })

  it('resuelve correctamente un periodo mensual válido', () => {
    const range = resolvePeriodRange({
      timezone: 'America/Mexico_City',
      period: 'month',
      anchorDate: '2026-04-15T10:00:00.000Z',
    })

    expect(range.fromUtc).toBeInstanceOf(Date)
    expect(range.toUtc).toBeInstanceOf(Date)
    expect(range.fromUtc.getTime()).toBeLessThanOrEqual(range.toUtc.getTime())
  })
})
