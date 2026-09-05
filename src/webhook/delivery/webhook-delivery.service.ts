import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { calculateBackoffMs } from './backoff';
import { SleepFn, WEBHOOK_SLEEP_FN } from './sleep.token';

export interface DeliveryResult {
  delivered: boolean;
  attempts: number;
  lastError?: string;
}

/**
 * Entrega o resultado de um job no `webhookUrl` do cliente, com retry e
 * backoff exponencial (`WEBHOOK_MAX_ATTEMPTS` tentativas, base
 * `WEBHOOK_BACKOFF_BASE_MS`). Isolado do resto da aplicacao: nem
 * WebhookService nem CepService sabem como a entrega e feita, so recebem
 * de volta { delivered, attempts, lastError }.
 *
 * Se todas as tentativas se esgotarem, quem chama (WebhookService) decide
 * mandar o job pra dead-letter - essa classe so relata o resultado final.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Inject(WEBHOOK_SLEEP_FN) private readonly sleep: SleepFn,
  ) {
    this.maxAttempts = Number(this.config.get('WEBHOOK_MAX_ATTEMPTS', 5));
    this.backoffBaseMs = Number(this.config.get('WEBHOOK_BACKOFF_BASE_MS', 1000));
  }

  async deliver(webhookUrl: string, payload: unknown, requestId: string): Promise<DeliveryResult> {
    let lastError = 'unknown';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await firstValueFrom(this.http.post(webhookUrl, payload, { timeout: 5000 }));
        this.logEvent('log', 'webhook_delivered', { requestId, webhookUrl, attempt });
        return { delivered: true, attempts: attempt };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.logEvent('warn', 'webhook_delivery_attempt_failed', {
          requestId,
          webhookUrl,
          attempt,
          maxAttempts: this.maxAttempts,
          error: lastError,
        });

        if (attempt < this.maxAttempts) {
          await this.sleep(calculateBackoffMs(attempt, this.backoffBaseMs));
        }
      }
    }

    this.logEvent('error', 'webhook_delivery_exhausted', {
      requestId,
      webhookUrl,
      attempts: this.maxAttempts,
      lastError,
    });
    return { delivered: false, attempts: this.maxAttempts, lastError };
  }

  private logEvent(level: 'log' | 'warn' | 'error', event: string, meta: Record<string, unknown>): void {
    this.logger[level](JSON.stringify({ event, ...meta }));
  }
}
