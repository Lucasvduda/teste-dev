import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { BrasilApiProvider } from './brasil-api.provider';
import { ProviderHttpError, ProviderNotFoundError, ProviderTimeoutError } from './provider.errors';

function makeConfig(): ConfigService {
  return { get: (_key: string, def?: unknown) => def } as unknown as ConfigService;
}

describe('BrasilApiProvider', () => {
  it('mapeia uma resposta valida para o contrato unificado', async () => {
    const http = {
      get: jest.fn().mockReturnValue(of({ data: { cep: '01001000', street: 'Praca da Se', neighborhood: 'Se', city: 'Sao Paulo', state: 'SP' } })),
    } as unknown as HttpService;
    const provider = new BrasilApiProvider(http, makeConfig());

    const result = await provider.lookup('01001000');

    expect(result).toEqual({ cep: '01001-000', street: 'Praca da Se', neighborhood: 'Se', city: 'Sao Paulo', state: 'SP' });
  });

  it('trata HTTP 404 como ProviderNotFoundError', async () => {
    const notFoundError = Object.assign(new AxiosError('Not Found'), { isAxiosError: true, response: { status: 404, data: {} } });
    const http = { get: jest.fn().mockReturnValue(throwError(() => notFoundError)) } as unknown as HttpService;
    const provider = new BrasilApiProvider(http, makeConfig());

    await expect(provider.lookup('99999999')).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it('trata timeout como ProviderTimeoutError', async () => {
    const timeoutError = Object.assign(new AxiosError('timeout of 5000ms exceeded'), { code: 'ETIMEDOUT', isAxiosError: true });
    const http = { get: jest.fn().mockReturnValue(throwError(() => timeoutError)) } as unknown as HttpService;
    const provider = new BrasilApiProvider(http, makeConfig());

    await expect(provider.lookup('01001000')).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('trata 500 como ProviderHttpError', async () => {
    const httpError = Object.assign(new AxiosError('Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500, data: {} },
    });
    const http = { get: jest.fn().mockReturnValue(throwError(() => httpError)) } as unknown as HttpService;
    const provider = new BrasilApiProvider(http, makeConfig());

    await expect(provider.lookup('01001000')).rejects.toBeInstanceOf(ProviderHttpError);
  });
});
