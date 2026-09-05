/**
 * Erros internos (nao-HTTP) usados entre os providers e o CepService pra
 * classificar CADA falha corretamente. Isso e o que permite tratar
 * "nao encontrado" de forma totalmente diferente de "timeout" ou "5xx",
 * em vez de jogar tudo num catch generico.
 */

/** O provider respondeu normalmente e disse, com confianca, que o CEP nao existe. */
export class ProviderNotFoundError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly cep: string,
  ) {
    super(`CEP ${cep} nao encontrado via ${providerName}`);
    this.name = 'ProviderNotFoundError';
  }
}

/** O provider nao respondeu dentro do tempo limite configurado. */
export class ProviderTimeoutError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly cep: string,
    public readonly timeoutMs: number,
  ) {
    super(`Provider ${providerName} nao respondeu em ${timeoutMs}ms para o CEP ${cep}`);
    this.name = 'ProviderTimeoutError';
  }
}

/** O provider respondeu com um erro tecnico (5xx, erro de rede, resposta inesperada). */
export class ProviderHttpError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly statusCode: number,
    message?: string,
  ) {
    super(message ?? `Provider ${providerName} retornou erro HTTP ${statusCode}`);
    this.name = 'ProviderHttpError';
  }
}

/** O circuit breaker desse provider esta aberto: nem tentamos chamar, pra falhar rapido. */
export class ProviderCircuitOpenError extends Error {
  constructor(public readonly providerName: string) {
    super(`Circuit breaker aberto para o provider ${providerName}, pulando tentativa`);
    this.name = 'ProviderCircuitOpenError';
  }
}

export function isTechnicalProviderError(
  err: unknown,
): err is ProviderTimeoutError | ProviderHttpError | ProviderCircuitOpenError {
  return err instanceof ProviderTimeoutError || err instanceof ProviderHttpError || err instanceof ProviderCircuitOpenError;
}
