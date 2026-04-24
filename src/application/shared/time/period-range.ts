import { dayjs } from './dayjs.js'
import { HttpError } from '../../../interfaces/http/errors/http-error.js'

export type Period = 'day' | 'week' | 'month' | 'year' | 'custom'

interface ResolvePeriodRangeArgs {
  timezone: string
  period?: Period
  from?: string
  to?: string
  anchorDate?: string
}

interface PeriodRange {
  fromUtc: Date
  toUtc: Date
}

const toUtcDate = (value: string, timezone: string): Date => {
  let parsed
  try {
    parsed = dayjs.tz(value, timezone)
  } catch {
    throw new HttpError(400, 'PERIODO_INVALIDO', `Fecha inválida: ${value}`)
  }

  if (!parsed.isValid()) {
    throw new HttpError(400, 'PERIODO_INVALIDO', `Fecha inválida: ${value}`)
  }

  return parsed.utc().toDate()
}

export const resolvePeriodRange = (args: ResolvePeriodRangeArgs): PeriodRange => {
  const period = args.period ?? 'month'
  let anchor
  try {
    anchor = args.anchorDate
      ? dayjs.tz(args.anchorDate, args.timezone)
      : dayjs().tz(args.timezone)
  } catch {
    throw new HttpError(400, 'PERIODO_INVALIDO', 'anchorDate inválida')
  }

  if (!anchor.isValid()) {
    throw new HttpError(400, 'PERIODO_INVALIDO', 'anchorDate inválida')
  }

  if (period === 'custom') {
    if (!args.from || !args.to) {
      throw new HttpError(400, 'PERIODO_INVALIDO', 'Para periodo custom se requieren from y to')
    }

    const fromUtc = toUtcDate(args.from, args.timezone)
    const toUtc = toUtcDate(args.to, args.timezone)

    if (fromUtc > toUtc) {
      throw new HttpError(400, 'PERIODO_INVALIDO', 'El rango de fechas es inválido')
    }

    return { fromUtc, toUtc }
  }

  const start =
    period === 'day'
      ? anchor.startOf('day')
      : period === 'week'
        ? anchor.startOf('isoWeek')
        : period === 'month'
          ? anchor.startOf('month')
          : anchor.startOf('year')

  const end =
    period === 'day'
      ? anchor.endOf('day')
      : period === 'week'
        ? anchor.endOf('isoWeek')
        : period === 'month'
          ? anchor.endOf('month')
          : anchor.endOf('year')

  return {
    fromUtc: start.utc().toDate(),
    toUtc: end.utc().toDate(),
  }
}
