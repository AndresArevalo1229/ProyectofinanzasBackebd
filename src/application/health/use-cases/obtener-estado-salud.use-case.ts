import type { EstadoSalud } from '../../../domain/health/estado-salud.js'
import type { IndicadorSaludBaseDatosPort } from '../ports/indicador-salud-base-datos.port.js'

export class ObtenerEstadoSaludUseCase {
  constructor(private readonly indicadorSaludBaseDatos: IndicadorSaludBaseDatosPort) {}

  async ejecutar(): Promise<EstadoSalud> {
    const dbDisponible = await this.indicadorSaludBaseDatos.verificarConexion()

    return {
      servicio: 'back_finanzas',
      estado: dbDisponible ? 'ok' : 'degradado',
      fecha: new Date().toISOString(),
      dependencias: {
        baseDatos: dbDisponible ? 'ok' : 'error',
      },
    }
  }
}
