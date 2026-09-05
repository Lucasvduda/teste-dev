import { CepService } from './cep.service';
import { ProviderRotator } from './utils/provider-rotator';
import { CepProvider, CepLookupResult } from './providers/cep-provider.interface';
import { ProviderHttpError, ProviderNotFoundError, ProviderTimeoutError } from './providers/provider.errors';
import { AllProvidersUnavailableException, CepNotFoundException } from './errors/http.exceptions';

function fakeResult(source: string): CepLookupResult {
  return { cep: '01001-000', street: 'Praca da Se', neighborhood: 'Se', city: 'Sao Paulo', state: source };
}

function makeProvider(name: string): CepProvider & { lookup: jest.Mock } {
  return { name, lookup: jest.fn() };
}

describe('CepService', () => {
  const REQUEST_ID = 'test-request-id';

  it('devolve o resultado do primeiro provider quando ele responde com sucesso, sem chamar o segundo', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockResolvedValue(fakeResult('viacep'));

    const service = new CepService([providerA, providerB], new ProviderRotator());
    const result = await service.lookup('01001000', REQUEST_ID);

    expect(result.source).toBe('viacep');
    expect(result.requestId).toBe(REQUEST_ID);
    expect(providerA.lookup).toHaveBeenCalledWith('01001000');
    expect(providerB.lookup).not.toHaveBeenCalled();
  });

  it('faz failover para o segundo provider quando o primeiro falha tecnicamente (timeout)', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockRejectedValue(new ProviderTimeoutError('viacep', '01001000', 5000));
    providerB.lookup.mockResolvedValue(fakeResult('brasil-api'));

    const service = new CepService([providerA, providerB], new ProviderRotator());
    const result = await service.lookup('01001000', REQUEST_ID);

    expect(result.source).toBe('brasil-api');
    expect(providerA.lookup).toHaveBeenCalledTimes(1);
    expect(providerB.lookup).toHaveBeenCalledTimes(1);
  });

  it('faz failover quando o primeiro falha com erro HTTP (5xx)', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockRejectedValue(new ProviderHttpError('viacep', 500));
    providerB.lookup.mockResolvedValue(fakeResult('brasil-api'));

    const service = new CepService([providerA, providerB], new ProviderRotator());
    const result = await service.lookup('01001000', REQUEST_ID);

    expect(result.source).toBe('brasil-api');
  });

  it('devolve CepNotFoundException quando TODOS os providers dizem que nao encontraram', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockRejectedValue(new ProviderNotFoundError('viacep', '99999999'));
    providerB.lookup.mockRejectedValue(new ProviderNotFoundError('brasil-api', '99999999'));

    const service = new CepService([providerA, providerB], new ProviderRotator());

    await expect(service.lookup('99999999', REQUEST_ID)).rejects.toBeInstanceOf(CepNotFoundException);
  });

  it('devolve AllProvidersUnavailableException quando TODOS os providers falham tecnicamente', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockRejectedValue(new ProviderTimeoutError('viacep', '01001000', 5000));
    providerB.lookup.mockRejectedValue(new ProviderHttpError('brasil-api', 503));

    const service = new CepService([providerA, providerB], new ProviderRotator());

    await expect(service.lookup('01001000', REQUEST_ID)).rejects.toBeInstanceOf(AllProvidersUnavailableException);
  });

  it('quando um provider diz "nao encontrado" e o outro falha tecnicamente, devolve 503 (nao ha confirmacao suficiente pra 404)', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockRejectedValue(new ProviderNotFoundError('viacep', '01001000'));
    providerB.lookup.mockRejectedValue(new ProviderTimeoutError('brasil-api', '01001000', 5000));

    const service = new CepService([providerA, providerB], new ProviderRotator());

    await expect(service.lookup('01001000', REQUEST_ID)).rejects.toBeInstanceOf(AllProvidersUnavailableException);
  });

  it('alterna qual provider e tentado primeiro entre requisicoes consecutivas (round-robin)', async () => {
    const providerA = makeProvider('viacep');
    const providerB = makeProvider('brasil-api');
    providerA.lookup.mockResolvedValue(fakeResult('viacep'));
    providerB.lookup.mockResolvedValue(fakeResult('brasil-api'));

    const service = new CepService([providerA, providerB], new ProviderRotator());

    const first = await service.lookup('01001000', 'req-1');
    const second = await service.lookup('01001000', 'req-2');

    expect(first.source).toBe('viacep');
    expect(second.source).toBe('brasil-api');
  });
});
