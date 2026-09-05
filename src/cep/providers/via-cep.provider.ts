import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { CepLookupResult, CepProvider } from './cep-provider.interface';
import { ProviderHttpError, ProviderNotFoundError, ProviderTimeoutError } from './provider.errors';

interface ViaCepRawResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/**
 * Provider concreto para a ViaCEP. Particularidade dessa API: quando o CEP
 * nao existe, ela responde HTTP 200 com o corpo `{ erro: true }` (nao um
 * 404!). Isolar essa peculiaridade aqui e exatamente o ponto da abstracao:
 * o resto da aplicacao so ve `ProviderNotFoundError`, nunca sabe que a
 * ViaCEP funciona assim.
 */
@Injectable()
export class ViaCepProvider implements CepProvider {
  readonly name = 'viacep';
  private readonly logger = new Logger(ViaCepProvider.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('VIACEP_BASE_URL', 'https://viacep.com.br/ws');
    this.timeoutMs = Number(this.config.get('PROVIDER_TIMEOUT_MS', 5000));
  }

  async lookup(cep: string): Promise<CepLookupResult> {
    const url = `${this.baseUrl}/${cep}/json/`;

    let data: ViaCepRawResponse;
    try {
      const response = await firstValueFrom(this.http.get<ViaCepRawResponse>(url, { timeout: this.timeoutMs }));
      data = response.data;
    } catch (err) {
      throw this.mapError(err, cep);
    }

    if (!data || data.erro) {
      throw new ProviderNotFoundError(this.name, cep);
    }

    return {
      cep: this.formatCep(data.cep ?? cep),
      street: data.logradouro ?? '',
      neighborhood: data.bairro ?? '',
      city: data.localidade ?? '',
      state: data.uf ?? '',
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
        // ViaCEP devolve 400 pra CEP mal formatado; como ja validamos o
        // formato antes de chegar aqui, tratamos por seguranca como
        // "nao encontrado" em vez de erro tecnico.
        if (err.response.status === 400) {
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
