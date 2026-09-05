import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import type { RequestWithId } from '../common/middleware/request-id.middleware';
import { CreateBatchWebhookDto } from './dto/create-batch-webhook.dto';
import { WebhookService } from './webhook.service';

@Controller('webhooks/cep-batch')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // Rota literal precisa vir ANTES de ':id', senão "dead-letter" seria
  // interpretado como um id de job (mesma pegadinha de roteamento do
  // Express/Nest já documentada no restante do projeto).
  @Get('dead-letter')
  async listDeadLetter() {
    return this.webhookService.listDeadLetter();
  }

  @Post()
  async create(@Body() dto: CreateBatchWebhookDto, @Req() req: RequestWithId, @Res({ passthrough: true }) res: Response) {
    const requestId = req.requestId ?? randomUUID();
    const { job, created } = await this.webhookService.createOrReuse(dto, requestId);

    // 202: job novo, processamento assincrono em andamento.
    // 200: idempotente - devolvendo o job que ja existia, nada novo foi criado.
    res.status(created ? 202 : 200);
    return { jobId: job.id, status: job.status, idempotent: !created, requestId };
  }

  @Get(':id')
  async getStatus(@Param('id') id: string) {
    return this.webhookService.getJob(id);
  }
}
