import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { CepLookupResult, CepProvider } from './cep-provider.interface';
import { ProviderHttpError, ProviderNotFoundError, ProviderTimeoutError } from './provider.errors';

interface BrasilApiRawResponse {
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  service?: string;
}

/**
 * Provider concreto para a BrasilAPI. Diferente da ViaCEP, ela usa HTTP
 * semanticamente correto: 404 quando o CEP nao existe. Isso mostra
 * exatamente por que a abstracao (CepProvider) vale a pena: cada provider
 * pode ter uma forma completamente diferente de sinalizar erro, e o
 * CepService nunca precisa saber disso.
 */
@Injectable()
export class BrasilApiProvider implements CepProvider {
  readonly name = 'brasil-api';
  private readonly logger = new Logger(BrasilApiProvider.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('BRASILAPI_BASE_URL', 'https://brasilapi.com.br/api/cep/v1');
    this.timeoutMs = Number(this.config.get('PROVIDER_TIMEOUT_MS', 5000));
  }

  async lookup(cep: string): Promise<CepLookupResult> {
    const url = `${this.baseUrl}/${cep}`;

    let data: BrasilApiRawResponse;
    try {
      const response = await firstValueFrom(this.http.get<BrasilApiRawResponse>(url, { timeout: this.timeoutMs }));
      data = response.data;
    } catch (err) {
      throw this.mapError(err, cep);
    }

    return {
      cep: this.formatCep(data.cep ?? cep),
      street: data.street ?? '',
      neighborhood: data.neighborhood ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
    };
  }

  private formatCep(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : raw;
  }

  private mapError(err: unknown, cep: string): Error {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        this.logger.warn(JSON.stringify({ event: 'provider_timeout', providerName: this.name, cep, timeoutMs: this.timeoutMs }));
        return new ProviderTimeoutError(this.name, cep, this.timeoutMs);
      }
      if (err.response) {
        if (err.response.status === 404) {
          return new ProviderNotFoundError(this.name, cep);
        }
        this.logger.warn(
          JSON.stringify({ event: 'provider_http_error', providerName: this.name, cep, statusCode: err.response.status }),
        );
        return new ProviderHttpError(this.name, err.response.status, err.message);
      }
      this.logger.warn(JSON.stringify({ event: 'provider_network_error', providerName: this.name, cep, message: err.message }));
      return new ProviderHttpError(this.name, 0, err.message);
    }
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    return new ProviderHttpError(this.name, 0, message);
  }
}
