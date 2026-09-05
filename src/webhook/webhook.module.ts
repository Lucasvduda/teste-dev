import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CepModule } from '../cep/cep.module';
import { BullMqQueueDriver } from '../common/queue/bullmq-queue.driver';
import { InMemoryQueueDriver } from '../common/queue/in-memory-queue.driver';
import { QUEUE_DRIVER, QueueDriver } from '../common/queue/queue-driver.interface';
import { WebhookDeliveryService } from './delivery/webhook-delivery.service';
import { realSleep, WEBHOOK_SLEEP_FN } from './delivery/sleep.token';
import { BATCH_JOB_REPOSITORY, BatchJobRepositoryPort } from './repository/batch-job-repository.interface';
import { InMemoryBatchJobRepository } from './repository/in-memory-batch-job.repository';
import { MySqlBatchJobRepository } from './repository/mysql-batch-job.repository';
import { createMySqlPool } from './repository/mysql-pool.factory';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

/**
 * Modulo autocontido: so precisa de CepModule (reaproveita CepService,
 * já com abstração+resiliência+observabilidade prontas) e do seu próprio
 * HttpModule (usado pela WebhookDeliveryService pra fazer o POST no
 * webhook do cliente).
 *
 * Fila (QUEUE_DRIVER) e persistencia (BATCH_JOB_REPOSITORY) usam o MESMO
 * padrao do CepModule/CEP_PROVIDERS: uma factory injetada por ConfigService
 * escolhe a implementacao real (mesmo contrato, mesmo WebhookService, zero
 * mudanca fora deste arquivo).
 *
 *   QUEUE_DRIVER=memory (default, zero infra) | bullmq (Redis real)
 *   DB_DRIVER=memory   (default, zero infra) | mysql  (MySQL real)
 *
 * Ambos os drivers reais so sao INSTANCIADOS (nao ficam registrados como
 * @Injectable() do Nest) quando explicitamente selecionados - o boot
 * padrao do projeto nunca tenta abrir uma conexao de rede.
 */
@Module({
  imports: [HttpModule, CepModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookDeliveryService,
    InMemoryQueueDriver,
    InMemoryBatchJobRepository,
    { provide: WEBHOOK_SLEEP_FN, useValue: realSleep },
    {
      provide: QUEUE_DRIVER,
      inject: [ConfigService, InMemoryQueueDriver],
      useFactory: (config: ConfigService, inMemory: InMemoryQueueDriver): QueueDriver => {
        const driver = config.get<string>('QUEUE_DRIVER', 'memory');
        if (driver === 'bullmq') {
          return new BullMqQueueDriver({
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: Number(config.get('REDIS_PORT', 6379)),
          });
        }
        return inMemory;
      },
    },
    {
      provide: BATCH_JOB_REPOSITORY,
      inject: [ConfigService, InMemoryBatchJobRepository],
      useFactory: (config: ConfigService, inMemory: InMemoryBatchJobRepository): BatchJobRepositoryPort => {
        const driver = config.get<string>('DB_DRIVER', 'memory');
        if (driver === 'mysql') {
          const pool = createMySqlPool({
            host: config.get<string>('MYSQL_HOST', 'localhost'),
            port: Number(config.get('MYSQL_PORT', 3306)),
            user: config.get<string>('MYSQL_USER', 'root'),
            password: config.get<string>('MYSQL_PASSWORD', ''),
            database: config.get<string>('MYSQL_DATABASE', 'teste_dev'),
          });
          return new MySqlBatchJobRepository(pool);
        }
        return inMemory;
      },
    },
  ],
})
export class WebhookModule {}
