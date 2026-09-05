export interface QueueJobData {
  jobId: string;
  requestId: string;
}

export type QueueProcessor = (data: QueueJobData) => Promise<void>;

/**
 * Abstrai "onde/como" um job e processado, no mesmo espirito do
 * CepProvider: quem produz o job (WebhookService.createOrReuse) e quem
 * processa (WebhookService.processJob) nao sabem se estao falando com uma
 * fila em memoria ou com BullMQ+Redis real.
 *
 * O desenho (registerProcessor + enqueue com PAYLOAD serializavel, nao uma
 * closure) e proposital: e exatamente como BullMQ funciona (Queue.add manda
 * dados JSON, um Worker separado consome), entao o driver em memoria e o
 * driver BullMQ implementam o MESMO contrato de verdade - nao e uma
 * simulacao que só parece com BullMQ, é compatível o suficiente para troca
 * 1:1 (ver bullmq-queue.driver.ts).
 */
export interface QueueDriver {
  /** Chamado uma vez, no boot do modulo, pra registrar quem processa cada job. */
  registerProcessor(processor: QueueProcessor): void;
  /** Enfileira um job novo (fora do ciclo request/response de quem chamou). */
  enqueue(data: QueueJobData): Promise<void>;
}

export const QUEUE_DRIVER = 'QUEUE_DRIVER';
