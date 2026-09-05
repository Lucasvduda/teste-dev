import { CepFormatPipe } from './cep-format.pipe';
import { InvalidCepFormatException } from '../errors/http.exceptions';

describe('CepFormatPipe', () => {
  const pipe = new CepFormatPipe();

  it('aceita 8 digitos sem formatacao', () => {
    expect(pipe.transform('01001000')).toBe('01001000');
  });

  it('aceita com hifen e remove', () => {
    expect(pipe.transform('01001-000')).toBe('01001000');
  });

  it('aceita com pontuacao qualquer e remove', () => {
    expect(pipe.transform('01.001-000')).toBe('01001000');
  });

  it('rejeita menos de 8 digitos', () => {
    expect(() => pipe.transform('123')).toThrow(InvalidCepFormatException);
  });

  it('rejeita mais de 8 digitos', () => {
    expect(() => pipe.transform('123456789')).toThrow(InvalidCepFormatException);
  });

  it('rejeita letras', () => {
    expect(() => pipe.transform('abcdefgh')).toThrow(InvalidCepFormatException);
  });

  it('rejeita vazio', () => {
    expect(() => pipe.transform('')).toThrow(InvalidCepFormatException);
  });
});
