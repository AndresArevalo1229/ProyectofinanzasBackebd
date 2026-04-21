export interface MySqlConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export const buildDatabaseUrl = (config: MySqlConnectionConfig): string => {
  return `mysql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`
}
