import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString, IsUrl } from 'class-validator';

/**
 * Payload de `POST /webhooks/cep-batch`. `idempotencyKey` e obrigatorio
 * (nao geramos um pro cliente): quem chama decide o que identifica um
 * "mesmo pedido" pra ele (ex.: hash do proprio lote de CEPs, id de um job
 * interno do sistema do cliente etc), igual ao padrao usado por Stripe e
 * outras APIs de pagamento pra idempotencia.
 */
export class CreateBatchWebhookDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  ceps!: string[];

  // require_protocol: exige http(s):// explicito (rejeita texto solto tipo
  // "nao-e-uma-url"). require_tld: false: permite webhooks locais tipo
  // "http://localhost:3001/hook" pra facilitar teste/demo sem infra.
  @IsUrl({ require_protocol: true, require_tld: false })
  webhookUrl!: string;
}
