export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly codigo: string,
    message: string,
    public readonly detalles?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
