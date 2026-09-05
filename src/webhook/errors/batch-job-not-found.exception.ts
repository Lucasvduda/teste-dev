import { NotFoundException } from '@nestjs/common';

export class BatchJobNotFoundException extends NotFoundException {
  constructor(id: string) {
    super({ error: 'BATCH_JOB_NOT_FOUND', message: `Job ${id} nao encontrado.` });
  }
}
