import { describe, expect, it } from 'vitest'

import {
  crearRespuestaError,
  crearRespuestaExitosa,
} from '../../../../src/interfaces/http/contracts/respuesta-http.js'

describe('crearRespuestaExitosa', () => {
  it('genera la respuesta con contrato estándar y requestId', () => {
    const response = crearRespuestaExitosa({
      mensaje: 'OK',
      datos: { valor: 1 },
      requestId: 'req-123',
      metaAdicional: { pagina: 2, requestId: 'override' },
    })

    expect(response).toEqual({
      exito: true,
      mensaje: 'OK',
      datos: { valor: 1 },
      meta: {
        pagina: 2,
        requestId: 'req-123',
      },
      error: null,
    })
  })
})

describe('crearRespuestaError', () => {
  it('genera respuesta de error con codigo y detalles', () => {
    const response = crearRespuestaError({
      mensaje: 'Falló',
      codigo: 'ERROR_X',
      requestId: 'req-500',
      detalles: { campo: 'email' },
    })

    expect(response).toEqual({
      exito: false,
      mensaje: 'Falló',
      datos: null,
      meta: {
        requestId: 'req-500',
      },
      error: {
        codigo: 'ERROR_X',
        detalles: { campo: 'email' },
      },
    })
  })
})
