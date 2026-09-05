import { InMemoryQueueDriver } from './in-memory-queue.driver';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('InMemoryQueueDriver', () => {
  it('processa jobs em ordem FIFO, um por vez (concorrencia 1)', async () => {
    const driver = new InMemoryQueueDriver();
    const order: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    driver.registerProcessor(async (data) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      order.push(`start:${data.jobId}`);
      await sleep(data.jobId === 'A' ? 30 : 5);
      order.push(`end:${data.jobId}`);
      concurrent -= 1;
    });

    await driver.enqueue({ jobId: 'A', requestId: 'r1' });
    await driver.enqueue({ jobId: 'B', requestId: 'r2' });

    await sleep(100);

    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
    expect(maxConcurrent).toBe(1);
  });

  it('nao processa nada antes de registerProcessor ser chamado', async () => {
    const driver = new InMemoryQueueDriver();
    await driver.enqueue({ jobId: 'A', requestId: 'r1' });

    await sleep(20);
    expect(driver.size()).toBe(1);
  });

  it('continua processando os proximos jobs mesmo se um lancar erro', async () => {
    const driver = new InMemoryQueueDriver();
    const order: string[] = [];

    driver.registerProcessor(async (data) => {
      order.push(data.jobId);
      if (data.jobId === 'A') throw new Error('boom');
    });

    await driver.enqueue({ jobId: 'A', requestId: 'r1' });
    await driver.enqueue({ jobId: 'B', requestId: 'r2' });

    await sleep(30);

    expect(order).toEqual(['A', 'B']);
  });
});
