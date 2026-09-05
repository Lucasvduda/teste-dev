import { HttpService } from '@nestjs/axios';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { Observable, of, throwError } from 'rxjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';

/**
 * Testes end-to-end da aplicacao completa (controller -> pipe -> service ->
 * providers -> circuit breaker -> filtro de excecoes), passando por HTTP
 * real via supertest. A UNICA coisa mockada e o HttpService do axios -
 * nunca fazemos chamadas de rede reais nesses testes, pra serem rapidos e
 * deterministicos. A validacao contra as APIs reais e feita manualmente
 * (ver README, secao "smoke test").
 *
 * Cada teste cria uma aplicacao nova (App.init() do zero), assim o estado
 * do round-robin (ProviderRotator) e do circuit breaker sempre comeca
 * limpo e a ordem de tentativa fica previsivel: ViaCEP primeiro, depois
 * BrasilAPI.
 */

type HttpBehavior = (url: string) => Observable<{ data: unknown }>;

async function createApp(getBehavior: HttpBehavior): Promise<INestApplication> {
  const httpServiceMock = { get: jest.fn((url: string) => getBehavior(url)) };

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(HttpService)
    .useValue(httpServiceMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

function viaCepSuccess(): Observable<{ data: unknown }> {
  return of({ data: { cep: '01001000', logradouro: 'Praca da Se', bairro: 'Se', localidade: 'Sao Paulo', uf: 'SP' } });
}

function viaCepNotFound(): Observable<{ data: unknown }> {
  return of({ data: { erro: true } });
}

function brasilApiSuccess(): Observable<{ data: unknown }> {
  return of({ data: { cep: '01001000', street: 'Praca da Se', neighborhood: 'Se', city: 'Sao Paulo', state: 'SP' } });
}

function axiosTimeout(): Observable<never> {
  return throwError(() => Object.assign(new AxiosError('timeout of 5000ms exceeded'), { code: 'ECONNABORTED', isAxiosError: true }));
}

function axiosStatus(status: number): Observable<never> {
  return throwError(() =>
    Object.assign(new AxiosError(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } }),
  );
}

function axiosNetworkError(): Observable<never> {
  return throwError(() => Object.assign(new AxiosError('Network Error'), { isAxiosError: true }));
}

describe('GET /cep/:cep (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200: responde com o primeiro provider (ViaCEP) quando ele tem sucesso, sem chamar o segundo', async () => {
    const getMock = jest.fn((url: string) => (url.includes('viacep') ? viaCepSuccess() : brasilApiSuccess()));
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/01001000').expect(200);

    expect(res.body).toMatchObject({
      cep: '01001-000',
      street: 'Praca da Se',
      neighborhood: 'Se',
      city: 'Sao Paulo',
      state: 'SP',
      source: 'viacep',
    });
    expect(typeof res.body.requestId).toBe('string');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('200: faz failover pra BrasilAPI quando a ViaCEP demora demais (timeout)', async () => {
    const getMock = jest.fn((url: string) => (url.includes('viacep') ? axiosTimeout() : brasilApiSuccess()));
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/01001000').expect(200);

    expect(res.body.source).toBe('brasil-api');
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('200: faz failover pra BrasilAPI quando a ViaCEP responde 5xx', async () => {
    const getMock = jest.fn((url: string) => (url.includes('viacep') ? axiosStatus(500) : brasilApiSuccess()));
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/01001000').expect(200);

    expect(res.body.source).toBe('brasil-api');
  });

  it('404: quando os dois providers concordam que o CEP nao existe', async () => {
    const getMock = jest.fn((url: string) => (url.includes('viacep') ? viaCepNotFound() : axiosStatus(404)));
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/99999999').expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, error: 'CEP_NOT_FOUND' });
    expect(typeof res.body.requestId).toBe('string');
  });

  it('503: quando os dois providers estao indisponiveis (timeout / erro de rede)', async () => {
    const getMock = jest.fn((url: string) => (url.includes('viacep') ? axiosTimeout() : axiosNetworkError()));
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/01001000').expect(503);

    expect(res.body).toMatchObject({ statusCode: 503, error: 'ALL_PROVIDERS_UNAVAILABLE' });
  });

  it('400: CEP com formato invalido nunca chega a chamar um provider externo', async () => {
    const getMock = jest.fn(() => viaCepSuccess());
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/abc').expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, error: 'INVALID_CEP_FORMAT' });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('propaga o x-request-id enviado pelo cliente em vez de gerar um novo', async () => {
    const getMock = jest.fn(() => viaCepSuccess());
    app = await createApp(getMock);

    const res = await request(app.getHttpServer()).get('/cep/01001000').set('x-request-id', 'meu-id-customizado').expect(200);

    expect(res.headers['x-request-id']).toBe('meu-id-customizado');
    expect(res.body.requestId).toBe('meu-id-customizado');
  });

  it('GET /health responde 200 ok', async () => {
    app = await createApp(() => viaCepSuccess());

    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });
});
