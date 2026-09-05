import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BatchJob, BatchJobStatus } from '../entities/batch-job.entity';
import {
  BatchJobRepositoryPort,
  CreateBatchJobInput,
  UpdateBatchJobInput,
} from './batch-job-repository.interface';

/**
 * Driver DEFAULT: Map em memoria. Zero infra - garante que o projeto roda
 * com `npm install && npm run start:dev`, sem precisar de banco nenhum.
 * Simula, de forma simplificada, o que uma tabela com
 * UNIQUE(idempotency_key) faria: garante que a mesma chave de idempotencia
 * sempre resolve pro mesmo job.
 */
@Injectable()
export class InMemoryBatchJobRepository implements BatchJobRepositoryPort {
  private readonly byId = new Map<string, BatchJob>();
  private readonly idByIdempotencyKey = new Map<string, string>();

  async create(input: CreateBatchJobInput): Promise<BatchJob> {
    const now = new Date().toISOString();
    const job: BatchJob = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      webhookUrl: input.webhookUrl,
      ceps: input.ceps,
      status: 'pending',
      results: [],
      deliveryAttempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(job.id, job);
    this.idByIdempotencyKey.set(job.idempotencyKey, job.id);
    return job;
  }

  async findById(id: string): Promise<BatchJob | null> {
    return this.byId.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<BatchJob | null> {
    const id = this.idByIdempotencyKey.get(key);
    return id ? this.byId.get(id) ?? null : null;
  }

  async update(id: string, patch: UpdateBatchJobInput): Promise<void> {
    const job = this.byId.get(id);
    if (!job) return;
    this.byId.set(id, { ...job, ...patch, updatedAt: new Date().toISOString() });
  }

  async listByStatus(status: BatchJobStatus): Promise<BatchJob[]> {
    return [...this.byId.values()].filter((job) => job.status === status);
  }
}
