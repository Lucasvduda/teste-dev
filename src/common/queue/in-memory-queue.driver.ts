import { Injectable, Logger } from '@nestjs/common';
import { QueueDriver, QueueJobData, QueueProcessor } from './queue-driver.interface';

/**
 * Driver de fila em memoria, com processamento sequencial (concorrencia 1).
 * Zero infra - e o driver DEFAULT, garante que o projeto roda com
 * `npm install && npm run start:dev`, sem precisar de Redis. Trocar pro
 * BullMqQueueDriver e so mudar QUEUE_DRIVER=bullmq no .env (ver
 * webhook.module.ts) - nada em WebhookService muda.
 */
@Injectable()
export class InMemoryQueueDriver implements QueueDriver {
  private readonly logger = new Logger(InMemoryQueueDriver.name);
  private readonly pending: QueueJobData[] = [];
  private draining = false;
  private processor: QueueProcessor | null = null;

  registerProcessor(processor: QueueProcessor): void {
    this.processor = processor;
  }

  async enqueue(data: QueueJobData): Promise<void> {
    this.pending.push(data);
    void this.drain();
  }

  size(): number {
    return this.pending.length;
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.processor) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const data = this.pending.shift();
        if (!data) continue;
        try {
          await this.processor(data);
        } catch (err) {
          this.logger.error(
            JSON.stringify({
              event: 'queue_task_unhandled_error',
              jobId: data.jobId,
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
