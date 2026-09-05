import { createPool, Pool } from 'mysql2/promise';

export interface MySqlPoolOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * `mysql2` so abre a conexao TCP de fato no primeiro `execute`/`query`
 * (pool "lazy" por natureza) - criar o pool aqui, mesmo sem um MySQL
 * disponivel, nao trava nem derruba o boot da aplicacao.
 */
export function createMySqlPool(options: MySqlPoolOptions): Pool {
  return createPool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    waitForConnections: true,
    connectionLimit: 10,
  });
}
