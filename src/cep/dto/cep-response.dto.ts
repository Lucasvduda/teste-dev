import { CepLookupResult } from '../providers/cep-provider.interface';

/**
 * Contrato unico devolvido pela nossa API, independente de qual provider
 * externo respondeu. `source` e `requestId` sao os unicos campos que nao
 * vem do provider: existem so pra observabilidade/depuracao.
 */
export interface CepResponseDto extends CepLookupResult {
  /** Qual provider externo efetivamente respondeu essa requisicao. */
  source: string;
  /** Correlation id da requisicao (tambem devolvido no header x-request-id). */
  requestId: string;
}
