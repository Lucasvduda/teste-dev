import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

interface ErrorPayload {
  statusCode: number;
  error: string;
  message: string;
  requestId: string;
  path: string;
  timestamp: string;
}

/**
 * Filtro global: toda exceção (esperada ou nao) sai no mesmo formato de
 * resposta, sempre com requestId e o codigo de erro (`error`) legivel por
 * maquina, alem da `message` legivel por humano. Tambem loga de forma
 * estruturada, separando 4xx (warn - erro esperado do cliente) de 5xx
 * (error - algo real quebrou do nosso lado / dos providers).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.requestId ?? 'unknown';

    const { status, errorCode, message } = this.resolve(exception);

    const payload: ErrorPayload = {
      statusCode: status,
      error: errorCode,
      message,
      requestId,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    const logLine = JSON.stringify({ event: 'request_failed', ...payload });
    if (status >= 500) this.logger.error(logLine);
    else this.logger.warn(logLine);

    response.status(status).json(payload);
  }

  private resolve(exception: unknown): { status: number; errorCode: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const asRecord = body as Record<string, unknown>;
        return {
          status,
          errorCode: typeof asRecord.error === 'string' ? asRecord.error : exception.constructor.name,
          message: typeof asRecord.message === 'string' ? asRecord.message : exception.message,
        };
      }
      return { status, errorCode: exception.constructor.name, message: String(body) };
    }

    if (exception instanceof Error) {
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, errorCode: 'INTERNAL_ERROR', message: exception.message };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, errorCode: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' };
  }
}
