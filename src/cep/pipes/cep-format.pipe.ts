import { Injectable, PipeTransform } from '@nestjs/common';
import { InvalidCepFormatException } from '../errors/http.exceptions';

/**
 * Valida e normaliza o parametro :cep antes dele chegar no controller.
 * Aceita com ou sem hifen/pontuacao ("01001-000", "01001000", "01001.000")
 * e sempre entrega 8 digitos limpos pro resto da aplicacao. CEP mal
 * formatado nunca chega a chamar um provider externo (falha rapido, 400).
 */
@Injectable()
export class CepFormatPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const digits = (value ?? '').replace(/\D/g, '');
    if (digits.length !== 8) {
      throw new InvalidCepFormatException(value);
    }
    return digits;
  }
}
