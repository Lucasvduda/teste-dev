import { LoggerService } from '@nestjs/common';

/**
 * Logger estruturado (JSON por linha), substituindo o Logger padrao do Nest
 * na raiz da aplicacao (main.ts). Objetivo: observabilidade real - em
 * produção, essas linhas iriam pra um agregador (CloudWatch, Datadog, etc)
 * e cada campo (event, requestId, providerName...) fica pesquisavel.
 *
 * Mensagens que ja chegam como JSON (ver logEvent() em CepService) sao
 * "desembrulhadas" pra dentro do campo `message`, em vez de virarem uma
 * string escapada dentro de outra string.
 */
export class AppLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', trace ? { message, trace } : message, context);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(level: string, message: unknown, context?: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: this.normalizeMessage(message),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  private normalizeMessage(message: unknown): unknown {
    if (typeof message !== 'string') return message;
    const trimmed = message.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return message;
    try {
      return JSON.parse(trimmed);
    } catch {
      return message;
    }
  }
}
