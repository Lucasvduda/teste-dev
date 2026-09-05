import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { ViaCepProvider } from './via-cep.provider';
import { ProviderHttpError, ProviderNotFoundError, ProviderTimeoutError } from './provider.errors';

function makeConfig(): ConfigService {
  return { get: (_key: string, def?: unknown) => def } as unknown as ConfigService;
}

describe('ViaCepProvider', () => {
  it('mapeia uma resposta valida para o contrato unificado', async () => {
    const http = { get: jest.fn().mockReturnValue(of({ data: { cep: '01001000', logradouro: 'Praca da Se', bairro: 'Se', localidade: 'Sao Paulo', uf: 'SP' } })) } as unknown as HttpService;
    const provider = new ViaCepProvider(http, makeConfig());

    const result = await provider.lookup('01001000');

    expect(result).toEqual({ cep: '01001-000', street: 'Praca da Se', neighborhood: 'Se', city: 'Sao Paulo', state: 'SP' });
  });

  it('trata { erro: true } como ProviderNotFoundError (peculiaridade da ViaCEP)', async () => {
    const http = { get: jest.fn().mockReturnValue(of({ data: { erro: true } })) } as unknown as HttpService;
    const provider = new ViaCepProvider(http, makeConfig());

    await expect(provider.lookup('99999999')).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it('trata timeout (ECONNABORTED) como ProviderTimeoutError', async () => {
    const timeoutError = Object.assign(new AxiosError('timeout of 5000ms exceeded'), { code: 'ECONNABORTED', isAxiosError: true });
    const http = { get: jest.fn().mockReturnValue(throwError(() => timeoutError)) } as unknown as HttpService;
    const provider = new ViaCepProvider(http, makeConfig());

    await expect(provider.lookup('01001000')).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('trata 500 como ProviderHttpError', async () => {
    const httpError = Object.assign(new AxiosError('Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500, data: {} },
    });
    const http = { get: jest.fn().mockReturnValue(throwError(() => httpError)) } as unknown as HttpService;
    const provider = new ViaCepProvider(http, makeConfig());

    await expect(provider.lookup('01001000')).rejects.toBeInstanceOf(ProviderHttpError);
  });

  it('trata erro de rede sem resposta como ProviderHttpError', async () => {
    const networkError = Object.assign(new AxiosError('Network Error'), { isAxiosError: true });
    const http = { get: jest.fn().mockReturnValue(throwError(() => networkError)) } as unknown as HttpService;
    const provider = new ViaCepProvider(http, makeConfig());

    await expect(provider.lookup('01001000')).rejects.toBeInstanceOf(ProviderHttpError);
  });
});
