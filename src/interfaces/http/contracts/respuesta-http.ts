export interface MetaRespuesta {
  requestId: string
  [key: string]: unknown
}

export interface ErrorEstandar {
  codigo: string
  detalles: unknown
}

export interface RespuestaExitosa<TData> {
  exito: true
  mensaje: string
  datos: TData
  meta: MetaRespuesta
  error: null
}

export interface RespuestaError {
  exito: false
  mensaje: string
  datos: null
  meta: MetaRespuesta
  error: ErrorEstandar
}

interface CrearRespuestaExitosaArgs<TData> {
  mensaje: string
  datos: TData
  requestId: string
  metaAdicional?: Record<string, unknown>
}

interface CrearRespuestaErrorArgs {
  mensaje: string
  codigo: string
  requestId: string
  detalles?: unknown
  metaAdicional?: Record<string, unknown>
}

const crearMeta = (requestId: string, metaAdicional?: Record<string, unknown>): MetaRespuesta => {
  return {
    ...(metaAdicional ?? {}),
    requestId,
  }
}

export const crearRespuestaExitosa = <TData>(
  args: CrearRespuestaExitosaArgs<TData>,
): RespuestaExitosa<TData> => {
  return {
    exito: true,
    mensaje: args.mensaje,
    datos: args.datos,
    meta: crearMeta(args.requestId, args.metaAdicional),
    error: null,
  }
}

export const crearRespuestaError = (args: CrearRespuestaErrorArgs): RespuestaError => {
  return {
    exito: false,
    mensaje: args.mensaje,
    datos: null,
    meta: crearMeta(args.requestId, args.metaAdicional),
    error: {
      codigo: args.codigo,
      detalles: args.detalles ?? null,
    },
  }
}
