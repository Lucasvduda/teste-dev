/**
 * Testa o WIRING do driver (enqueue -> Queue.add, registerProcessor ->
 * Worker delega pro processor, close() fecha as duas conexoes) com a lib
 * `bullmq` mockada. Nao valida a conexao de rede real com Redis (nao
 * disponivel neste ambiente) - ver README, secao "Drivers reais".
 */
const addMock = jest.fn();
const closeQueueMock = jest.fn();
const closeWorkerMock = jest.fn();
const workerHandlers: Record<string, (...args: unknown[]) => void> = {};
let capturedProcessor: ((job: unknown) => Promise<void>) | null = null;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: addMock,
    close: closeQueueMock,
  })),
  Worker: jest.fn().mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
    capturedProcessor = processor;
    return {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        workerHandlers[event] = handler;
      }),
      close: closeWorkerMock,
    };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { BullMqQueueDriver } from './bullmq-queue.driver';

describe('BullMqQueueDriver', () => {
  beforeEach(() => {
    addMock.mockClear();
    closeQueueMock.mockClear();
    closeWorkerMock.mockClear();
    capturedProcessor = null;
    Object.keys(workerHandlers).forEach((key) => delete workerHandlers[key]);
  });

  it('enqueue chama Queue.add com o nome do job e o payload serializavel', async () => {
    const driver = new BullMqQueueDriver({ host: 'localhost', port: 6379 });

    await driver.enqueue({ jobId: 'job-1', requestId: 'req-1' });

    expect(addMock).toHaveBeenCalledWith(
      'process-cep-batch',
      { jobId: 'job-1', requestId: 'req-1' },
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('registerProcessor cria um Worker que delega pro processor registrado', async () => {
    const driver = new BullMqQueueDriver({ host: 'localhost', port: 6379 });
    const processor = jest.fn().mockResolvedValue(undefined);

    driver.registerProcessor(processor);
    expect(capturedProcessor).not.toBeNull();

    await capturedProcessor?.({ data: { jobId: 'job-1', requestId: 'req-1' } });

    expect(processor).toHaveBeenCalledWith({ jobId: 'job-1', requestId: 'req-1' });
  });

  it('close() fecha o worker e a queue', async () => {
    const driver = new BullMqQueueDriver({ host: 'localhost', port: 6379 });
    driver.registerProcessor(jest.fn());

    await driver.close();

    expect(closeWorkerMock).toHaveBeenCalledTimes(1);
    expect(closeQueueMock).toHaveBeenCalledTimes(1);
  });

  it('registra handlers de failed/error no worker sem lancar excecao', () => {
    const driver = new BullMqQueueDriver({ host: 'localhost', port: 6379 });
    driver.registerProcessor(jest.fn());

    expect(workerHandlers.failed).toBeDefined();
    expect(workerHandlers.error).toBeDefined();
    expect(() => workerHandlers.error(new Error('conexao recusada'))).not.toThrow();
    expect(() => workerHandlers.failed({ data: { jobId: 'x' } }, new Error('falhou'))).not.toThrow();
  });

  it('usa "cep-batch-jobs" como nome padrao da fila, ou o nome customizado se informado', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bullmq = require('bullmq');
    new BullMqQueueDriver({ host: 'localhost', port: 6379 });
    expect(bullmq.Queue).toHaveBeenCalledWith('cep-batch-jobs', expect.anything());

    new BullMqQueueDriver({ host: 'localhost', port: 6379, queueName: 'outra-fila' });
    expect(bullmq.Queue).toHaveBeenCalledWith('outra-fila', expect.anything());
  });
});
