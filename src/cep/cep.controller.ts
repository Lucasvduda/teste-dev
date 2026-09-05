import { Controller, Get, Param, Req } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RequestWithId } from '../common/middleware/request-id.middleware';
import { CepService } from './cep.service';
import { CepResponseDto } from './dto/cep-response.dto';
import { CepFormatPipe } from './pipes/cep-format.pipe';

@Controller('cep')
export class CepController {
  constructor(private readonly cepService: CepService) {}

  @Get(':cep')
  async getCep(@Param('cep', CepFormatPipe) cep: string, @Req() req: RequestWithId): Promise<CepResponseDto> {
    const requestId = req.requestId ?? randomUUID();
    return this.cepService.lookup(cep, requestId);
  }
}
