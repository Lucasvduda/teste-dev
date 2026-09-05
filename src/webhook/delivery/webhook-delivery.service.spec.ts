import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { WebhookDeliveryService } from './webhook-delivery.service';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string, def?: unknown) => (key in overrides ? overrides[key] : def) } as unknown as ConfigService;
}

describe('WebhookDeliveryService', () => {
  it('entrega com sucesso na primeira tentativa, sem precisar de retry', async () => {
    const http = { post: jest.fn().mockReturnValue(of({ data: {} })) } as unknown as HttpService;
    const sleep = jest.fn().mockResolvedValue(undefined);
    const service = new WebhookDeliveryService(http, makeConfig(), sleep);

    const result = await service.deliver('https://example.com/hook', { foo: 'bar' }, 'req-1');

    expect(result).toEqual({ delivered: true, attempts: 1 });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('tenta de novo com backoff exponencial apos falha, e entrega na segunda tentativa', async () => {
    const http = {
      post: jest.fn().mockReturnValueOnce(throwError(() => new Error('ECONNREFUSED'))).mockReturnValueOnce(of({ data: {} })),
    } as unknown as HttpService;
    const sleep = jest.fn().mockResolvedValue(undefined);
    const service = new WebhookDeliveryService(http, makeConfig({ WEBHOOK_BACKOFF_BASE_MS: 1000 }), sleep);

    const result = await service.deliver('https://example.com/hook', {}, 'req-1');

    expect(result).toEqual({ delivered: true, attempts: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('depois de esgotar todas as tentativas, devolve delivered=false com o ultimo erro', async () => {
    const http = { post: jest.fn().mockReturnValue(throwError(() => new Error('ECONNREFUSED'))) } as unknown as HttpService;
    const sleep = jest.fn().mockResolvedValue(undefined);
    const service = new WebhookDeliveryService(http, makeConfig({ WEBHOOK_MAX_ATTEMPTS: 3, WEBHOOK_BACKOFF_BASE_MS: 100 }), sleep);

    const result = await service.deliver('https://example.com/hook', {}, 'req-1');

    expect(result).toEqual({ delivered: false, attempts: 3, lastError: 'ECONNREFUSED' });
    expect(http.post).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // so espera ENTRE tentativas, nao depois da ultima
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });
});
