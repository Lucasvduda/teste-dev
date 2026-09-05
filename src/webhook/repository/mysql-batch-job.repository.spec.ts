import type { Pool } from 'mysql2/promise';
import { MySqlBatchJobRepository } from './mysql-batch-job.repository';

/**
 * Testa a logica de SQL/mapeamento (quais queries sao disparadas, como as
 * linhas viram BatchJob) com um Pool FAKE (nao a lib `mysql2` real
 * conectando a um banco). Nao ha MySQL disponivel neste ambiente pra um
 * teste de integracao de ponta a ponta - ver README, secao "Drivers
 * reais".
 */
function makeFakePool(): jest.Mocked<Pick<Pool, 'execute'>> {
  return { execute: jest.fn() } as unknown as jest.Mocked<Pick<Pool, 'execute'>>;
}

const row = {
  id: 'job-1',
  idempotency_key: 'key-1',
  webhook_url: 'https://example.com/hook',
  ceps: JSON.stringify(['01001000']),
  status: 'pending',
  results: JSON.stringify([]),
  delivery_attempts: 0,
  last_error: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('MySqlBatchJobRepository', () => {
  it('create insere a linha e devolve a entidade com status pending', async () => {
    const pool = makeFakePool();
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined] as never);
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    const job = await repo.create({ idempotencyKey: 'key-1', webhookUrl: 'https://example.com/hook', ceps: ['01001000'] });

    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cep_batch_jobs'),
      expect.arrayContaining(['key-1', 'https://example.com/hook', JSON.stringify(['01001000'])]),
    );
    expect(job.status).toBe('pending');
    expect(job.idempotencyKey).toBe('key-1');
  });

  it('findById mapeia a linha (JSON parseado) pra BatchJob', async () => {
    const pool = makeFakePool();
    pool.execute.mockResolvedValueOnce([[row], undefined] as never);
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    const job = await repo.findById('job-1');

    expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ?'), ['job-1']);
    expect(job).toMatchObject({ id: 'job-1', idempotencyKey: 'key-1', ceps: ['01001000'], status: 'pending' });
  });

  it('findById devolve null quando nao ha linha', async () => {
    const pool = makeFakePool();
    pool.execute.mockResolvedValueOnce([[], undefined] as never);
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    expect(await repo.findById('nao-existe')).toBeNull();
  });

  it('findByIdempotencyKey consulta pela coluna correta', async () => {
    const pool = makeFakePool();
    pool.execute.mockResolvedValueOnce([[row], undefined] as never);
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    await repo.findByIdempotencyKey('key-1');

    expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('WHERE idempotency_key = ?'), ['key-1']);
  });

  it('update monta o UPDATE apenas com os campos informados no patch', async () => {
    const pool = makeFakePool();
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined] as never);
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    await repo.update('job-1', { status: 'delivered', deliveryAttempts: 2 });

    const [sql, values] = pool.execute.mock.calls[0];
    expect(sql).toContain('status = ?');
    expect(sql).toContain('delivery_attempts = ?');
    expect(sql).not.toContain('results = ?');
    expect(values).toEqual(expect.arrayContaining(['delivered', 2, 'job-1']));
  });

  it('update com patch vazio nao dispara query', async () => {
    const pool = makeFakePool();
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    await repo.update('job-1', {});

    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('listByStatus filtra pela coluna status e mapeia todas as linhas', async () => {
    const pool = makeFakePool();
    pool.execute.mockResolvedValueOnce([[row, { ...row, id: 'job-2' }], undefined] as never);
    const repo = new MySqlBatchJobRepository(pool as unknown as Pool);

    const jobs = await repo.listByStatus('pending');

    expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('WHERE status = ?'), ['pending']);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toEqual(['job-1', 'job-2']);
  });
});
