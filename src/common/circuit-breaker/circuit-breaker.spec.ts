import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('comeca CLOSED e permite tentativas', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('abre depois de N falhas consecutivas e passa a rejeitar', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');
    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('um sucesso no meio do caminho reseta o contador de falhas', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('depois do cooldown, entra em HALF_OPEN e libera uma tentativa', () => {
    let currentTime = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => currentTime });

    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canAttempt()).toBe(false);

    currentTime = 999;
    expect(breaker.canAttempt()).toBe(false);

    currentTime = 1000;
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('sucesso em HALF_OPEN fecha o circuito', () => {
    let currentTime = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => currentTime });

    breaker.recordFailure();
    currentTime = 1000;
    breaker.canAttempt();
    breaker.recordSuccess();

    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('falha em HALF_OPEN reabre o circuito e reinicia o cooldown', () => {
    let currentTime = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => currentTime });

    breaker.recordFailure();
    currentTime = 1000;
    breaker.canAttempt();
    breaker.recordFailure();

    expect(breaker.getState()).toBe('OPEN');
    currentTime = 1500;
    expect(breaker.canAttempt()).toBe(false);
    currentTime = 2000;
    expect(breaker.canAttempt()).toBe(true);
  });
});
