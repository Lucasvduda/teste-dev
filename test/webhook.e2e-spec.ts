import { HttpService } from '@nestjs/axios';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { createValidationPipe } from '../src/common/pipes/validation-pipe.factory';
import { WEBHOOK_SLEEP_FN } from '../src/webhook/delivery/sleep.token';

/**
 * E2e do fluxo assincrono completo: cria job (202) -> processa em
 * background (fila em memoria) -> entrega no webhook (com retry) ->
 * cliente consulta o status via GET. HttpService mockado (GET pros
 * providers de CEP, POST pro webhook) e o sleep do backoff trocado por um
 * no-op, pra rodar rapido e deterministico.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function viaCepSuccess(cep = '01001000') {
  return of({ data: { cep, logradouro: 'Praca da Se', bairro: 'Se', localidade: 'Sao Paulo', uf: 'SP' } });
}

async function createApp(httpMock: { get: jest.Mock; post: jest.Mock }): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HttpService)
    .useValue(httpMock)
    .overrideProvider(WEBHOOK_SLEEP_FN)
    .useValue(async () => {})
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

interface JobBody {
  jobId: string;
  status: string;
  [key: string]: unknown;
}

async function waitForStatus(app: INestApplication, jobId: string, statuses: string[], timeoutMs = 3000): Promise<JobBody> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app.getHttpServer()).get(`/webhooks/cep-batch/${jobId}`);
    if (statuses.includes(res.body.status)) return res.body as JobBody;
    await sleep(10);
  }
  throw new Error(`Timeout esperando status [${statuses.join(', ')}] para o job ${jobId}`);
}

describe('Webhook de batch de CEP (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('cria o job (202), processa em background e entrega no webhook com sucesso', async () => {
    const getMock = jest.fn(() => viaCepSuccess());
    const postMock = jest.fn(() => of({ data: { received: true } }));
    app = await createApp({ get: getMock, post: postMock });

    const createRes = await request(app.getHttpServer())
      .post('/webhooks/cep-batch')
      .send({ idempotencyKey: 'e2e-key-1', ceps: ['01001000'], webhookUrl: 'https://example.com/hook' })
      .expect(202);

    expect(createRes.body).toMatchObject({ status: 'pending', idempotent: false });

    const finalJob = await waitForStatus(app, createRes.body.jobId, ['delivered', 'dead_letter']);

    expect(finalJob.status).toBe('delivered');
    expect(finalJob.results).toEqual([expect.objectContaining({ cep: '01001000', ok: true })]);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('idempotencia: reenviar a mesma idempotencyKey devolve 200 e nao cria job novo', async () => {
    const getMock = jest.fn(() => viaCepSuccess());
    const postMock = jest.fn(() => of({ data: {} }));
    app = await createApp({ get: getMock, post: postMock });

    const first = await request(app.getHttpServer())
      .post('/webhooks/cep-batch')
      .send({ idempotencyKey: 'e2e-key-dup', ceps: ['01001000'], webhookUrl: 'https://example.com/hook' })
      .expect(202);

    await waitForStatus(app, first.body.jobId, ['delivered', 'dead_letter']);

    const second = await request(app.getHttpServer())
      .post('/webhooks/cep-batch')
      .send({ idempotencyKey: 'e2e-key-dup', ceps: ['99999999'], webhookUrl: 'https://example.com/hook' })
      .expect(200);

    expect(second.body).toMatchObject({ jobId: first.body.jobId, idempotent: true });
    expect(getMock).toHaveBeenCalledTimes(1); // segundo cep (99999999) nunca foi consultado
  });

  it('dead-letter: se a entrega ao webhook falhar sempre, o job termina como dead_letter e aparece na listagem', async () => {
    const getMock = jest.fn(() => viaCepSuccess());
    const postMock = jest.fn(() => throwError(() => new Error('ECONNREFUSED')));
    app = await createApp({ get: getMock, post: postMock });

    const createRes = await request(app.getHttpServer())
      .post('/webhooks/cep-batch')
      .send({ idempotencyKey: 'e2e-key-dl', ceps: ['01001000'], webhookUrl: 'https://example.com/hook' })
      .expect(202);

    const finalJob = await waitForStatus(app, createRes.body.jobId, ['dead_letter']);
    expect(finalJob.status).toBe('dead_letter');

    const deadLetterList = await request(app.getHttpServer()).get('/webhooks/cep-batch/dead-letter').expect(200);
    expect(deadLetterList.body.map((j: { id: string }) => j.id)).toContain(createRes.body.jobId);
  });

  it('400: payload invalido (webhookUrl que nao e uma URL) e rejeitado pela validacao global', async () => {
    app = await createApp({ get: jest.fn(() => viaCepSuccess()), post: jest.fn() });

    const res = await request(app.getHttpServer())
      .post('/webhooks/cep-batch')
      .send({ idempotencyKey: 'k', ceps: ['01001000'], webhookUrl: 'nao-e-uma-url' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('400: payload sem idempotencyKey e rejeitado', async () => {
    app = await createApp({ get: jest.fn(() => viaCepSuccess()), post: jest.fn() });

    const res = await request(app.getHttpServer())
      .post('/webhooks/cep-batch')
      .send({ ceps: ['01001000'], webhookUrl: 'https://example.com/hook' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('404: consultar um job inexistente', async () => {
    app = await createApp({ get: jest.fn(), post: jest.fn() });

    const res = await request(app.getHttpServer()).get('/webhooks/cep-batch/nao-existe').expect(404);

    expect(res.body.error).toBe('BATCH_JOB_NOT_FOUND');
  });
});
