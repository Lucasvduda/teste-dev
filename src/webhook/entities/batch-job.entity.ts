import { CepResponseDto } from '../../cep/dto/cep-response.dto';

export type BatchJobStatus = 'pending' | 'processing' | 'completed' | 'delivered' | 'dead_letter';

export interface CepBatchResult {
  cep: string;
  ok: boolean;
  data?: CepResponseDto;
  error?: { code: string; message: string };
}

export interface BatchJob {
  id: string;
  /** Chave de idempotencia fornecida pelo cliente: reenviar a mesma nao cria job novo. */
  idempotencyKey: string;
  webhookUrl: string;
  ceps: string[];
  status: BatchJobStatus;
  results: CepBatchResult[];
  deliveryAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
