import { BadRequestException, ValidationPipe } from '@nestjs/common';

/**
 * ValidationPipe global com exceptionFactory customizada, pra erros de
 * validacao de DTO (class-validator) sairem no MESMO formato
 * { error, message } usado pelo resto da aplicacao (ver
 * AllExceptionsFilter), em vez do formato padrao do Nest (`message` como
 * array de strings).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => {
      const message = errors
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .filter(Boolean)
        .join(' | ');
      return new BadRequestException({ error: 'VALIDATION_ERROR', message: message || 'Payload invalido.' });
    },
  });
}
