export interface EstadoSalud {
  servicio: string
  estado: 'ok' | 'degradado'
  fecha: string
  dependencias: {
    baseDatos: 'ok' | 'error'
  }
}
