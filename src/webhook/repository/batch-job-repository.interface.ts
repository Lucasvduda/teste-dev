import { BatchJob, BatchJobStatus } from '../entities/batch-job.entity';

export type CreateBatchJobInput = Pick<BatchJob, 'idempotencyKey' | 'webhookUrl' | 'ceps'>;
export type UpdateBatchJobInput = Partial<Omit<BatchJob, 'id' | 'idempotencyKey' | 'createdAt'>>;

/**
 * Mesmo principio de abstracao do CepProvider, aplicado a persistencia:
 * WebhookService so conhece esse contrato, nunca sabe se os jobs estao
 * num Map em memoria ou numa tabela MySQL. Trocar o driver (ver
 * BATCH_JOB_REPOSITORY em webhook.module.ts) nao exige mudar nada em
 * WebhookService, WebhookController ou nos testes que usam esse contrato.
 */
export interface BatchJobRepositoryPort {
  create(input: CreateBatchJobInput): Promise<BatchJob>;
  findById(id: string): Promise<BatchJob | null>;
  findByIdempotencyKey(key: string): Promise<BatchJob | null>;
  update(id: string, patch: UpdateBatchJobInput): Promise<void>;
  listByStatus(status: BatchJobStatus): Promise<BatchJob[]>;
}

export const BATCH_JOB_REPOSITORY = 'BATCH_JOB_REPOSITORY';
