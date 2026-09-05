import { CircuitBreaker } from '../../common/circuit-breaker/circuit-breaker';
import { CepLookupResult, CepProvider } from './cep-provider.interface';
import { ProviderCircuitOpenError, ProviderNotFoundError } from './provider.errors';

/**
 * Decorator: envolve qualquer CepProvider com um circuit breaker, sem o
 * provider real precisar saber que isso existe. Padrao Decorator classico:
 * implementa a mesma interface (CepProvider), delega a chamada real e
 * observa o resultado.
 *
 * Regra importante: "nao encontrado" (ProviderNotFoundError) NAO conta
 * como falha do circuito - o provider respondeu certinho, so nao tinha
 * aquele CEP. So falha tecnica (timeout, 5xx, erro de rede) conta.
 */
export class CircuitBreakerProvider implements CepProvider {
  constructor(
    private readonly inner: CepProvider,
    private readonly breaker: CircuitBreaker,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async lookup(cep: string): Promise<CepLookupResult> {
    if (!this.breaker.canAttempt()) {
      throw new ProviderCircuitOpenError(this.name);
    }

    try {
      const result = await this.inner.lookup(cep);
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        this.breaker.recordSuccess();
      } else {
        this.breaker.recordFailure();
      }
      throw err;
    }
  }
}
