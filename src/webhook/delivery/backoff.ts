/**
 * Backoff exponencial simples: tentativa 1 -> baseMs, tentativa 2 -> baseMs*2,
 * tentativa 3 -> baseMs*4, etc. Pura e determinística de proposito (sem
 * jitter aleatorio) pra ficar 100% previsivel em teste.
 */
export function calculateBackoffMs(attempt: number, baseMs: number): number {
  if (attempt < 1) return 0;
  return baseMs * 2 ** (attempt - 1);
}
