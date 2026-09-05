import { Logger } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { QueueDriver, QueueJobData, QueueProcessor } from './queue-driver.interface';

export interface BullMqDriverOptions {
  host: string;
  port: number;
  queueName?: string;
}

/**
 * Driver de fila REAL usando BullMQ + Redis (a stack pedida na vaga:
 * "filas e processamento assincrono, especialmente BullMQ, RabbitMQ ou
 * SQS"). Implementa o MESMO contrato (`QueueDriver`) do driver em
 * memoria - troca via `QUEUE_DRIVER=bullmq` no `.env`, sem mudar uma
 * linha de `WebhookService`.
 *
 * Deliberadamente NAO e `@Injectable()`/registrado no modulo Nest: e
 * instanciado manualmente dentro da factory de QUEUE_DRIVER
 * (webhook.module.ts) SOMENTE quando selecionado. Isso evita que o Nest
 * crie uma conexao com Redis no boot da aplicacao quando o driver
 * default (memoria) esta em uso - o projeto continua rodando com
 * `npm install && npm run start:dev`, sem Redis, por padrao.
 *
 * `lazyConnect: true` no ioredis: so tenta conectar quando o driver for
 * de fato usado (enqueue/registerProcessor), nao na hora de instanciar a
 * classe - mesmo que alguem selecione QUEUE_DRIVER=bullmq sem Redis
 * disponivel, o boot da aplicacao nao trava nem lanca excecao sincrona.
 *
 * Honestidade sobre teste: a logica de wiring (enqueue chama Queue.add,
 * registerProcessor cria um Worker que delega pro processor) e testada em
 * `bullmq-queue.driver.spec.ts` com a lib `bullmq` mockada (sem Redis
 * real). Nao tenho Docker/Redis disponivel neste ambiente pra validar a
 * conexao de rede de ponta a ponta - ver README para o que isso significa
 * na pratica.
 */
export class BullMqQueueDriver implements QueueDriver {
  private readonly logger = new Logger(BullMqQueueDriver.name);
  private readonly queueName: string;
  private readonly connection: { host: string; port: number; lazyConnect: boolean; maxRetriesPerRequest: null };
  private readonly queue: Queue<QueueJobData>;
  private worker: Worker<QueueJobData> | null = null;

  constructor(options: BullMqDriverOptions) {
    this.queueName = options.queueName ?? 'cep-batch-jobs';
    this.connection = {
      host: options.host,
      port: options.port,
      lazyConnect: true,
      // recomendado pelo proprio BullMQ para workers/queues em produção
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue<QueueJobData>(this.queueName, { connection: this.connection });
  }

  registerProcessor(processor: QueueProcessor): void {
    this.worker = new Worker<QueueJobData>(
      this.queueName,
      async (job: Job<QueueJobData>) => {
        await processor(job.data);
      },
      { connection: this.connection },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        JSON.stringify({ event: 'bullmq_job_failed', jobId: job?.data?.jobId, message: err.message }),
      );
    });
    this.worker.on('error', (err) => {
      // erro de conexao com o Redis, por exemplo - nao derruba o processo,
      // so registra; o BullMQ tenta reconectar sozinho.
      this.logger.error(JSON.stringify({ event: 'bullmq_worker_error', message: err.message }));
    });
  }

  async enqueue(data: QueueJobData): Promise<void> {
    await this.queue.add('process-cep-batch', data, {
      // O retry de negocio (reentrega no webhook do cliente, dead-letter)
      // ja e feito pelo nosso proprio dominio (WebhookDeliveryService).
      // Aqui deixamos 1 tentativa de PROCESSAR o job em si (se o processo
      // cair no meio, o job fica no Redis e pode ser retomado por outro
      // worker - isso e o ganho real de usar BullMQ em vez da fila em
      // memoria: sobrevive a reinicio do processo).
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
