export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Numero de falhas tecnicas consecutivas antes de abrir o circuito. */
  failureThreshold: number;
  /** Tempo (ms) que o circuito fica aberto antes de permitir uma tentativa de teste. */
  cooldownMs: number;
  /** Injetavel para testes deterministicos (default: Date.now). */
  now?: () => number;
}

/**
 * Circuit breaker simples e deterministico (sem timers reais, sem I/O).
 *
 * CLOSED     -> chamadas normais. N falhas consecutivas -> OPEN.
 * OPEN       -> rejeita rapido (sem nem tentar) até passar o cooldown.
 * HALF_OPEN  -> depois do cooldown, libera 1 tentativa; sucesso -> CLOSED,
 *               falha -> OPEN de novo (reinicia o cooldown).
 *
 * Por que isso importa pro problema do teste: quando "as duas APIs estao
 * fora", sem circuit breaker o serviço ficaria tentando (e esperando o
 * timeout) as duas em toda requisição. Com o breaker, depois de algumas
 * falhas seguidas, a gente para de tentar o provider que sabemos que esta
 * fora, e falha rapido - resposta mais rapida pro cliente, menos carga
 * inutil nos providers externos.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  canAttempt(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true;
    // state === 'OPEN'
    if (this.openedAt !== null && this.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = 'HALF_OPEN';
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    const shouldOpen = this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.options.failureThreshold;
    if (shouldOpen) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
