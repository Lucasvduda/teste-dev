import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreaker } from '../common/circuit-breaker/circuit-breaker';
import { CepController } from './cep.controller';
import { CepService } from './cep.service';
import { BrasilApiProvider } from './providers/brasil-api.provider';
import { CepProvider } from './providers/cep-provider.interface';
import { CEP_PROVIDERS } from './providers/cep-providers.token';
import { CircuitBreakerProvider } from './providers/circuit-breaker-provider.decorator';
import { ViaCepProvider } from './providers/via-cep.provider';
import { ProviderRotator } from './utils/provider-rotator';

@Module({
  imports: [HttpModule],
  controllers: [CepController],
  providers: [
    CepService,
    ProviderRotator,
    ViaCepProvider,
    BrasilApiProvider,
    {
      provide: CEP_PROVIDERS,
      inject: [ViaCepProvider, BrasilApiProvider, ConfigService],
      useFactory: (viaCep: ViaCepProvider, brasilApi: BrasilApiProvider, config: ConfigService): CepProvider[] => {
        const breakerOptions = {
          failureThreshold: Number(config.get('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 3)),
          cooldownMs: Number(config.get('CIRCUIT_BREAKER_COOLDOWN_MS', 30000)),
        };

        // Para adicionar um terceiro provider: implementar CepProvider
        // (ver via-cep.provider.ts como exemplo) e acrescentar mais uma
        // linha aqui, envolvida (ou nao) em CircuitBreakerProvider.
        // Nenhum outro arquivo do modulo cep precisa mudar.
        return [
          new CircuitBreakerProvider(viaCep, new CircuitBreaker(breakerOptions)),
          new CircuitBreakerProvider(brasilApi, new CircuitBreaker(breakerOptions)),
        ];
      },
    },
  ],
  exports: [CepService],
})
export class CepModule {}
