import { CircuitBreaker } from '../../common/circuit-breaker/circuit-breaker';
import { CircuitBreakerProvider } from './circuit-breaker-provider.decorator';
import { CepProvider, CepLookupResult } from './cep-provider.interface';
import { ProviderCircuitOpenError, ProviderHttpError, ProviderNotFoundError } from './provider.errors';

function fakeResult(): CepLookupResult {
  return { cep: '01001-000', street: 'Praca da Se', neighborhood: 'Se', city: 'Sao Paulo', state: 'SP' };
}

describe('CircuitBreakerProvider', () => {
  it('delega para o provider interno quando o circuito esta fechado', async () => {
    const inner: CepProvider = { name: 'fake', lookup: jest.fn().mockResolvedValue(fakeResult()) };
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    const wrapped = new CircuitBreakerProvider(inner, breaker);

    const result = await wrapped.lookup('01001000');

    expect(result).toEqual(fakeResult());
    expect(inner.lookup).toHaveBeenCalledWith('01001000');
  });

  it('propaga falha tecnica e conta como falha no breaker', async () => {
    const inner: CepProvider = { name: 'fake', lookup: jest.fn().mockRejectedValue(new ProviderHttpError('fake', 500)) };
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const wrapped = new CircuitBreakerProvider(inner, breaker);

    await expect(wrapped.lookup('01001000')).rejects.toBeInstanceOf(ProviderHttpError);
    expect(breaker.getState()).toBe('OPEN');
  });

  it('nao chama o provider interno quando o circuito esta aberto (falha rapido)', async () => {
    const inner: CepProvider = { name: 'fake', lookup: jest.fn().mockRejectedValue(new ProviderHttpError('fake', 500)) };
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const wrapped = new CircuitBreakerProvider(inner, breaker);

    await expect(wrapped.lookup('01001000')).rejects.toBeInstanceOf(ProviderHttpError);
    (inner.lookup as jest.Mock).mockClear();

    await expect(wrapped.lookup('01001000')).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(inner.lookup).not.toHaveBeenCalled();
  });

  it('"nao encontrado" nao conta como falha do circuito', async () => {
    const inner: CepProvider = {
      name: 'fake',
      lookup: jest.fn().mockRejectedValue(new ProviderNotFoundError('fake', '99999999')),
    };
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const wrapped = new CircuitBreakerProvider(inner, breaker);

    await expect(wrapped.lookup('99999999')).rejects.toBeInstanceOf(ProviderNotFoundError);
    expect(breaker.getState()).toBe('CLOSED');
  });
});
