import { InMemoryBatchJobRepository } from './in-memory-batch-job.repository';

describe('InMemoryBatchJobRepository', () => {
  it('cria um job e busca por id', async () => {
    const repo = new InMemoryBatchJobRepository();
    const job = await repo.create({ idempotencyKey: 'k1', webhookUrl: 'https://x.com', ceps: ['01001000'] });

    const found = await repo.findById(job.id);

    expect(found).toEqual(job);
    expect(job.status).toBe('pending');
  });

  it('busca por idempotencyKey', async () => {
    const repo = new InMemoryBatchJobRepository();
    const job = await repo.create({ idempotencyKey: 'k2', webhookUrl: 'https://x.com', ceps: [] });

    const found = await repo.findByIdempotencyKey('k2');

    expect(found?.id).toBe(job.id);
  });

  it('devolve null quando id ou idempotencyKey nao existem', async () => {
    const repo = new InMemoryBatchJobRepository();
    expect(await repo.findById('nao-existe')).toBeNull();
    expect(await repo.findByIdempotencyKey('nao-existe')).toBeNull();
  });

  it('update aplica o patch corretamente', async () => {
    const repo = new InMemoryBatchJobRepository();
    const job = await repo.create({ idempotencyKey: 'k3', webhookUrl: 'https://x.com', ceps: [] });

    await repo.update(job.id, { status: 'delivered', deliveryAttempts: 2 });
    const updated = await repo.findById(job.id);

    expect(updated?.status).toBe('delivered');
    expect(updated?.deliveryAttempts).toBe(2);
    expect(new Date(updated?.updatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(job.updatedAt).getTime());
  });

  it('update em id inexistente nao lanca erro (no-op)', async () => {
    const repo = new InMemoryBatchJobRepository();
    await expect(repo.update('nao-existe', { status: 'delivered' })).resolves.toBeUndefined();
  });

  it('listByStatus filtra corretamente', async () => {
    const repo = new InMemoryBatchJobRepository();
    const a = await repo.create({ idempotencyKey: 'a', webhookUrl: 'https://x.com', ceps: [] });
    await repo.create({ idempotencyKey: 'b', webhookUrl: 'https://x.com', ceps: [] });
    await repo.update(a.id, { status: 'dead_letter' });

    const deadLetter = await repo.listByStatus('dead_letter');

    expect(deadLetter).toHaveLength(1);
    expect(deadLetter[0].id).toBe(a.id);
  });
});
