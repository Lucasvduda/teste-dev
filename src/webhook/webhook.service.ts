import { HttpException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CepService } from '../cep/cep.service';
import { normalizeCepOrNull } from '../cep/utils/cep-format.util';
import { QUEUE_DRIVER, QueueDriver } from '../common/queue/queue-driver.interface';
import { WebhookDeliveryService } from './delivery/webhook-delivery.service';
import { CreateBatchWebhookDto } from './dto/create-batch-webhook.dto';
import { BatchJob, CepBatchResult } from './entities/batch-job.entity';
import { BatchJobNotFoundException } from './errors/batch-job-not-found.exception';
import { BATCH_JOB_REPOSITORY, BatchJobRepositoryPort } from './repository/batch-job-repository.interface';

export interface CreateBatchResult {
  job: BatchJob;
  created: boolean;
}

/**
 * Orquestra o fluxo de "consulta CEP em lote, avisa por webhook quando
 * terminar":
 *
 *  1. Idempotencia: a mesma `idempotencyKey` nunca cria um segundo job nem
 *     reprocessa - devolve o job existente (padrao Stripe-like).
 *  2. Enfileira o processamento (QueueDriver - fila em memoria por
 *     padrao, ou BullMQ+Redis real via QUEUE_DRIVER=bullmq) e responde
 *     202 IMEDIATAMENTE - o trabalho pesado roda depois, fora do ciclo
 *     request/response (processamento assincrono real).
 *  3. Cada CEP do lote passa pelo MESMO CepService do endpoint sincrono
 *     (mesma abstracao, mesmo failover, mesmo circuit breaker) - um CEP
 *     invalido ou nao encontrado dentro do lote so marca aquele item como
 *     `ok: false`, sem derrubar o job inteiro (sucesso parcial).
 *  4. Ao final, tenta entregar o resultado no webhook do cliente
 *     (WebhookDeliveryService, com retry + backoff). Se esgotar as
 *     tentativas, o job vira `dead_letter` (visivel em
 *     GET /webhooks/cep-batch/dead-letter) em vez de se perder.
 */
@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(BATCH_JOB_REPOSITORY) private readonly repo: BatchJobRepositoryPort,
    private readonly cepService: CepService,
    private readonly delivery: WebhookDeliveryService,
    @Inject(QUEUE_DRIVER) private readonly queue: QueueDriver,
  ) {}

  /** Registra, uma unica vez, quem processa cada job da fila (independe do driver escolhido). */
  onModuleInit(): void {
    this.queue.registerProcessor((data) => this.processJob(data.jobId, data.requestId));
  }

  async createOrReuse(dto: CreateBatchWebhookDto, requestId: string): Promise<CreateBatchResult> {
    const existing = await this.repo.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      this.logEvent('log', 'batch_job_idempotent_replay', {
        requestId,
        jobId: existing.id,
        idempotencyKey: dto.idempotencyKey,
      });
      return { job: existing, created: false };
    }

    const job = await this.repo.create({
      idempotencyKey: dto.idempotencyKey,
      webhookUrl: dto.webhookUrl,
      ceps: dto.ceps,
    });
    this.logEvent('log', 'batch_job_created', { requestId, jobId: job.id, cepCount: dto.ceps.length });

    await this.queue.enqueue({ jobId: job.id, requestId });

    return { job, created: true };
  }

  async getJob(id: string): Promise<BatchJob> {
    const job = await this.repo.findById(id);
    if (!job) throw new BatchJobNotFoundException(id);
    return job;
  }

  async listDeadLetter(): Promise<BatchJob[]> {
    return this.repo.listByStatus('dead_letter');
  }

  private async processJob(jobId: string, requestId: string): Promise<void> {
    await this.repo.update(jobId, { status: 'processing' });
    const job = await this.repo.findById(jobId);
    if (!job) return;

    const results: CepBatchResult[] = [];
    for (const rawCep of job.ceps) {
      const normalized = normalizeCepOrNull(rawCep);
      if (!normalized) {
        results.push({
          cep: rawCep,
          ok: false,
          error: { code: 'INVALID_CEP_FORMAT', message: `CEP "${rawCep}" invalido. Use 8 digitos.` },
        });
        continue;
      }

      try {
        const data = await this.cepService.lookup(normalized, requestId);
        results.push({ cep: normalized, ok: true, data });
      } catch (err) {
        results.push({ cep: normalized, ok: false, error: this.toErrorPayload(err) });
      }
    }

    await this.repo.update(jobId, { status: 'completed', results });
    this.logEvent('log', 'batch_job_processed', {
      requestId,
      jobId,
      cepCount: job.ceps.length,
      okCount: results.filter((r) => r.ok).length,
    });

    const deliveryResult = await this.delivery.deliver(
      job.webhookUrl,
      { jobId, idempotencyKey: job.idempotencyKey, results },
      requestId,
    );

    if (deliveryResult.delivered) {
      await this.repo.update(jobId, {
        status: 'delivered',
        deliveryAttempts: deliveryResult.attempts,
        lastError: null,
      });
    } else {
      await this.repo.update(jobId, {
        status: 'dead_letter',
        deliveryAttempts: deliveryResult.attempts,
        lastError: deliveryResult.lastError ?? 'unknown',
      });
      this.logEvent('error', 'batch_job_dead_letter', {
        requestId,
        jobId,
        attempts: deliveryResult.attempts,
        lastError: deliveryResult.lastError,
      });
    }
  }

  private toErrorPayload(err: unknown): { code: string; message: string } {
    if (err instanceof HttpException) {
      const body = err.getResponse();
      if (typeof body === 'object' && body !== null) {
        const rec = body as Record<string, unknown>;
        return {
          code: typeof rec.error === 'string' ? rec.error : 'ERROR',
          message: typeof rec.message === 'string' ? rec.message : err.message,
        };
      }
    }
    return { code: 'ERROR', message: err instanceof Error ? err.message : 'erro desconhecido' };
  }

  private logEvent(level: 'log' | 'warn' | 'error', event: string, meta: Record<string, unknown>): void {
    this.logger[level](JSON.stringify({ event, ...meta }));
  }
}
