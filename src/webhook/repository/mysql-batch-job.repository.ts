import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { BatchJob, BatchJobStatus } from '../entities/batch-job.entity';
import {
  BatchJobRepositoryPort,
  CreateBatchJobInput,
  UpdateBatchJobInput,
} from './batch-job-repository.interface';

interface BatchJobRow extends RowDataPacket {
  id: string;
  idempotency_key: string;
  webhook_url: string;
  ceps: string;
  status: BatchJobStatus;
  results: string;
  delivery_attempts: number;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Driver real de persistencia usando MySQL (`mysql2`), a stack pedida na
 * vaga ("MySQL, DynamoDB e AWS"). Implementa o MESMO contrato
 * (`BatchJobRepositoryPort`) do driver em memoria - troca via
 * `DB_DRIVER=mysql` no `.env` (ver webhook.module.ts), sem mudar nada em
 * WebhookService.
 *
 * `ceps` e `results` sao guardados como colunas JSON (suportado nativamente
 * desde MySQL 5.7+), evitando tabelas extras so pra um array de strings
 * simples. Schema completo em `schema.sql` neste mesmo diretorio.
 *
 * Deliberadamente NAO e `@Injectable()`: e instanciado manualmente na
 * factory de BATCH_JOB_REPOSITORY (webhook.module.ts) SOMENTE quando
 * `DB_DRIVER=mysql`, recebendo um Pool ja criado. Assim, com o driver
 * default (memoria), nunca tentamos abrir uma conexao MySQL no boot.
 *
 * Honestidade sobre teste: a logica de SQL/mapeamento e testada em
 * `mysql-batch-job.repository.spec.ts` com o Pool do `mysql2` mockado (sem
 * banco real - nao ha MySQL disponivel neste ambiente). Ver README.
 */
export class MySqlBatchJobRepository implements BatchJobRepositoryPort {
  private readonly logger = new Logger(MySqlBatchJobRepository.name);

  constructor(private readonly pool: Pool) {}

  async create(input: CreateBatchJobInput): Promise<BatchJob> {
    const id = randomUUID();
    const now = new Date();
    await this.pool.execute(
      `INSERT INTO cep_batch_jobs
         (id, idempotency_key, webhook_url, ceps, status, results, delivery_attempts, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', '[]', 0, NULL, ?, ?)`,
      [id, input.idempotencyKey, input.webhookUrl, JSON.stringify(input.ceps), now, now],
    );
    return {
      id,
      idempotencyKey: input.idempotencyKey,
      webhookUrl: input.webhookUrl,
      ceps: input.ceps,
      status: 'pending',
      results: [],
      deliveryAttempts: 0,
      lastError: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async findById(id: string): Promise<BatchJob | null> {
    const [rows] = await this.pool.execute<BatchJobRow[]>(
      'SELECT * FROM cep_batch_jobs WHERE id = ? LIMIT 1',
      [id],
    );
    return rows[0] ? this.toEntity(rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<BatchJob | null> {
    const [rows] = await this.pool.execute<BatchJobRow[]>(
      'SELECT * FROM cep_batch_jobs WHERE idempotency_key = ? LIMIT 1',
      [key],
    );
    return rows[0] ? this.toEntity(rows[0]) : null;
  }

  async update(id: string, patch: UpdateBatchJobInput): Promise<void> {
    const fields: string[] = [];
    const values: Array<string | number | Date | null> = [];

    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.results !== undefined) {
      fields.push('results = ?');
      values.push(JSON.stringify(patch.results));
    }
    if (patch.deliveryAttempts !== undefined) {
      fields.push('delivery_attempts = ?');
      values.push(patch.deliveryAttempts);
    }
    if (patch.lastError !== undefined) {
      fields.push('last_error = ?');
      values.push(patch.lastError);
    }
    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(new Date());
    values.push(id);

    await this.pool.execute(`UPDATE cep_batch_jobs SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async listByStatus(status: BatchJobStatus): Promise<BatchJob[]> {
    const [rows] = await this.pool.execute<BatchJobRow[]>(
      'SELECT * FROM cep_batch_jobs WHERE status = ?',
      [status],
    );
    return rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: BatchJobRow): BatchJob {
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      webhookUrl: row.webhook_url,
      ceps: JSON.parse(row.ceps) as string[],
      status: row.status,
      results: JSON.parse(row.results),
      deliveryAttempts: row.delivery_attempts,
      lastError: row.last_error,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
