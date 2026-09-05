/**
 * Normaliza um CEP bruto (com ou sem hifen/pontuacao) para 8 digitos,
 * ou devolve null se o formato for invalido. Usado tanto pelo
 * CepFormatPipe (endpoint sincrono, falha rapido com 400) quanto pelo
 * processamento de batch/webhook (onde um item invalido nao pode derrubar
 * o job inteiro - vira um resultado `ok: false` daquele item especifico).
 */
export function normalizeCepOrNull(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}
