import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

/**
 * Exceptions expostas na borda HTTP. Cada uma carrega um `error` (codigo
 * estavel, pensado pra quem consome a API programaticamente) e uma
 * `message` (texto legivel). O AllExceptionsFilter usa esses dois campos
 * pra montar a resposta final.
 */

export class InvalidCepFormatException extends BadRequestException {
  constructor(rawValue: string) {
    super({
      error: 'INVALID_CEP_FORMAT',
      message: `CEP "${rawValue}" invalido. Informe 8 digitos, com ou sem hifen (ex: 01001000 ou 01001-000).`,
    });
  }
}

export class CepNotFoundException extends NotFoundException {
  constructor(cep: string) {
    super({
      error: 'CEP_NOT_FOUND',
      message: `CEP ${cep} nao foi encontrado em nenhum dos providers consultados.`,
    });
  }
}

export class AllProvidersUnavailableException extends ServiceUnavailableException {
  constructor(cep: string) {
    super({
      error: 'ALL_PROVIDERS_UNAVAILABLE',
      message: `Nao foi possivel consultar o CEP ${cep} agora: os providers externos estao lentos ou indisponiveis. Tente novamente em alguns instantes.`,
    });
  }
}
