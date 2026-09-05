import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

const HEADER_NAME = 'x-request-id';

/**
 * Garante que toda requisicao tenha um requestId (correlation id):
 * usa o que o cliente mandou no header, ou gera um novo.
 * Devolve o mesmo id no header de resposta, pra quem chamou conseguir
 * correlacionar com os logs do lado dele tambem.
 *
 * Isso responde diretamente "se der erro em produção, como a gente
 * descobre o que aconteceu": todo log da requisicao (nossos e dos
 * providers) carrega esse mesmo id.
 */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers[HEADER_NAME];
  const requestId = typeof incoming === 'string' && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
  req.requestId = requestId;
  res.setHeader(HEADER_NAME, requestId);
  next();
}
