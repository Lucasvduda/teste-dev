import { CepService } from '../cep/cep.service';
import { CepNotFoundException } from '../cep/errors/http.exceptions';
import { InMemoryQueueDriver } from '../common/queue/in-memory-queue.driver';
import { WebhookDeliveryService } from './delivery/webhook-delivery.service';
import { BatchJobNotFoundException } from './errors/batch-job-not-found.exception';
import { InMemoryBatchJobRepository } from './repository/in-memory-batch-job.repository';
import { WebhookService } from './webhook.service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCepServiceMock(): jest.Mocked<Pick<CepService, 'lookup'>> {
  return { lookup: jest.fn() } as unknown as jest.Mocked<Pick<CepService, 'lookup'>>;
}

function makeDeliveryMock(): jest.Mocked<Pick<WebhookDeliveryService, 'deliver'>> {
  return { deliver: jest.fn() } as unknown as jest.Mocked<Pick<WebhookDeliveryService, 'deliver'>>;
}

function fakeCepData(cep: string, source: string) {
  return { cep, street: 'Rua Fake', neighborhood: 'Centro', city: 'Sao Paulo', state: 'SP', source, requestId: 'req-1' };
}

/**
 * Monta um WebhookService "de verdade" com o driver de fila em memoria
 * (mesma coisa que o webhook.module.ts monta por padrao). Chama
 * onModuleInit() manualmente porque aqui nao passamos pelo container do
 * Nest (unit test puro, sem TestingModule) - fora de um teste, o Nest
 * chama esse hook automaticamente no boot.
 */
function createService(
  repo: InMemoryBatchJobRepository,
  cepService: jest.Mocked<Pick<CepService, 'lookup'>>,
  delivery: jest.Mocked<Pick<WebhookDeliveryService, 'deliver'>>,
): WebhookService {
  const queue = new InMemoryQueueDriver();
  const service = new WebhookService(
    repo,
    cepService as unknown as CepService,
    delivery as unknown as WebhookDeliveryService,
    queue,
  );
  service.onModuleInit();
  return service;
}

describe('WebhookService', () => {
  it('cria um novo job (pending), processa os CEPs e entrega no webhook com sucesso', async () => {
    const repo = new InMemoryBatchJobRepository();
    const cepService = makeCepServiceMock();
    const delivery = makeDeliveryMock();

    cepService.lookup.mockResolvedValueOnce(fakeCepData('01001000', 'viacep'));
    delivery.deliver.mockResolvedValue({ delivered: true, attempts: 1 });

    const service = createService(repo, cepService, delivery);

    const { job, created } = await service.createOrReuse(
      { idempotencyKey: 'key-1', webhookUrl: 'https://example.com/hook', ceps: ['01001000'] },
      'req-1',
    );

    expect(created).toBe(true);
    expect(job.status).toBe('pending');

    await sleep(30);

    const finalJob = await repo.findById(job.id);
    expect(finalJob?.status).toBe('delivered');
    expect(finalJob?.results).toEqual([{ cep: '01001000', ok: true, data: expect.objectContaining({ source: 'viacep' }) }]);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('idempotencia: a segunda chamada com a mesma idempotencyKey nao cria job novo nem reprocessa', async () => {
    const repo = new InMemoryBatchJobRepository();
    const cepService = makeCepServiceMock();
    const delivery = makeDeliveryMock();
    cepService.lookup.mockResolvedValue(fakeCepData('01001000', 'viacep'));
    delivery.deliver.mockResolvedValue({ delivered: true, attempts: 1 });

    const service = createService(repo, cepService, delivery);

    const first = await service.createOrReuse(
      { idempotencyKey: 'dup-key', webhookUrl: 'https://example.com/hook', ceps: ['01001000'] },
      'req-1',
    );
    await sleep(20);

    const second = await service.createOrReuse(
      { idempotencyKey: 'dup-key', webhookUrl: 'https://example.com/hook', ceps: ['99999999'] },
      'req-2',
    );

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(cepService.lookup).toHaveBeenCalledTimes(1);
  });

  it('um CEP invalido ou nao encontrado dentro do lote nao derruba o job inteiro (sucesso parcial)', async () => {
    const repo = new InMemoryBatchJobRepository();
    const cepService = makeCepServiceMock();
    const delivery = makeDeliveryMock();

    cepService.lookup.mockResolvedValueOnce(fakeCepData('01001000', 'viacep')).mockRejectedValueOnce(new CepNotFoundException('99999999'));
    delivery.deliver.mockResolvedValue({ delivered: true, attempts: 1 });

    const service = createService(repo, cepService, delivery);
    const { job } = await service.createOrReuse(
      { idempotencyKey: 'key-partial', webhookUrl: 'https://example.com/hook', ceps: ['01001000', '99999999'] },
      'req-1',
    );

    await sleep(30);

    const finalJob = await repo.findById(job.id);
    expect(finalJob?.results).toHaveLength(2);
    expect(finalJob?.results[0].ok).toBe(true);
    expect(finalJob?.results[1]).toMatchObject({ cep: '99999999', ok: false, error: { code: 'CEP_NOT_FOUND' } });
    expect(finalJob?.status).toBe('delivered');
  });

  it('CEP com formato invalido dentro do lote e marcado como erro sem chamar o CepService', async () => {
    const repo = new InMemoryBatchJobRepository();
    const cepService = makeCepServiceMock();
    const delivery = makeDeliveryMock();
    delivery.deliver.mockResolvedValue({ delivered: true, attempts: 1 });

    const service = createService(repo, cepService, delivery);
    const { job } = await service.createOrReuse(
      { idempotencyKey: 'key-invalid', webhookUrl: 'https://example.com/hook', ceps: ['abc'] },
      'req-1',
    );

    await sleep(20);

    const finalJob = await repo.findById(job.id);
    expect(finalJob?.results).toEqual([{ cep: 'abc', ok: false, error: { code: 'INVALID_CEP_FORMAT', message: expect.any(String) } }]);
    expect(cepService.lookup).not.toHaveBeenCalled();
  });

  it('dead-letter: se a entrega falhar apos todas as tentativas, o job fica com status dead_letter', async () => {
    const repo = new InMemoryBatchJobRepository();
    const cepService = makeCepServiceMock();
    const delivery = makeDeliveryMock();

    cepService.lookup.mockResolvedValue(fakeCepData('01001000', 'viacep'));
    delivery.deliver.mockResolvedValue({ delivered: false, attempts: 5, lastError: 'ECONNREFUSED' });

    const service = createService(repo, cepService, delivery);
    const { job } = await service.createOrReuse(
      { idempotencyKey: 'key-dl', webhookUrl: 'https://example.com/hook', ceps: ['01001000'] },
      'req-1',
    );

    await sleep(30);

    const finalJob = await repo.findById(job.id);
    expect(finalJob?.status).toBe('dead_letter');
    expect(finalJob?.deliveryAttempts).toBe(5);
    expect(finalJob?.lastError).toBe('ECONNREFUSED');

    const deadLetterList = await service.listDeadLetter();
    expect(deadLetterList.map((j) => j.id)).toContain(job.id);
  });

  it('getJob lanca BatchJobNotFoundException quando o id nao existe', async () => {
    const repo = new InMemoryBatchJobRepository();
    const service = createService(repo, makeCepServiceMock(), makeDeliveryMock());

    await expect(service.getJob('nao-existe')).rejects.toBeInstanceOf(BatchJobNotFoundException);
  });
});
