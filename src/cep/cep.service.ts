import { Inject, Injectable, Logger } from '@nestjs/common';
import { AllProvidersUnavailableException, CepNotFoundException } from './errors/http.exceptions';
import { CepResponseDto } from './dto/cep-response.dto';
import { CEP_PROVIDERS } from './providers/cep-providers.token';
import { CepProvider } from './providers/cep-provider.interface';
import { ProviderNotFoundError } from './providers/provider.errors';
import { ProviderRotator } from './utils/provider-rotator';

/**
 * Orquestra a consulta de CEP entre todos os providers registrados.
 *
 * Estrategia:
 *  1. Pega a ordem de tentativa do ProviderRotator (round-robin: cada
 *     requisicao comeca por um provider diferente).
 *  2. Tenta cada provider, na ordem, ate um responder com sucesso.
 *  3. Uma falha TECNICA (timeout, 5xx, circuito aberto) de um provider
 *     NAO impede tentar o proximo - e exatamente o failover pedido.
 *  4. "Nao encontrado" de um provider so vira 404 se TODOS os providers
 *     tentados concordarem que o CEP nao existe. Se so alguns disserem
 *     "nao encontrado" e outros falharem tecnicamente, devolvemos 503
 *     (nao temos confirmacao suficiente pra garantir que o CEP realmente
 *     nao existe).
 *  5. So se restarem exclusivamente falhas tecnicas (ou for uma mistura
 *     sem nenhum "encontrado"), devolvemos 503 (ALL_PROVIDERS_UNAVAILABLE).
 *
 * Adicionar um terceiro provider: nao muda uma linha desse arquivo. Basta
 * implementar CepProvider e registra-lo na factory de CEP_PROVIDERS
 * (cep.module.ts).
 */
@Injectable()
export class CepService {
  private readonly logger = new Logger(CepService.name);

  constructor(
    @Inject(CEP_PROVIDERS) private readonly providers: CepProvider[],
    private readonly rotator: ProviderRotator,
  ) {}

  async lookup(cep: string, requestId: string): Promise<CepResponseDto> {
    const order = this.rotator.nextOrder(this.providers);
    let notFoundCount = 0;

    for (const provider of order) {
      const startedAt = Date.now();
      try {
        const result = await provider.lookup(cep);
        this.logEvent('log', 'provider_success', {
          requestId,
          cep,
          providerName: provider.name,
          durationMs: Date.now() - startedAt,
        });
        return { ...result, source: provider.name, requestId };
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        if (err instanceof ProviderNotFoundError) {
          notFoundCount += 1;
          this.logEvent('log', 'provider_not_found', { requestId, cep, providerName: provider.name, durationMs });
        } else {
          const reason = err instanceof Error ? err.name : 'UnknownError';
          const message = err instanceof Error ? err.message : String(err);
          this.logEvent('warn', 'provider_failed', {
            requestId,
            cep,
            providerName: provider.name,
            durationMs,
            reason,
            message,
          });
        }
      }
    }

    if (order.length > 0 && notFoundCount === order.length) {
      this.logEvent('log', 'cep_not_found', { requestId, cep, providersTried: order.map((p) => p.name) });
      throw new CepNotFoundException(cep);
    }

    this.logEvent('error', 'all_providers_unavailable', { requestId, cep, providersTried: order.map((p) => p.name) });
    throw new AllProvidersUnavailableException(cep);
  }

  private logEvent(level: 'log' | 'warn' | 'error', event: string, meta: Record<string, unknown>): void {
    const line = JSON.stringify({ event, ...meta });
    this.logger[level](line);
  }
}
