import { Injectable } from '@nestjs/common';

/**
 * Round-robin simples: cada chamada a nextOrder() comeca por um provider
 * diferente do anterior, e devolve TODOS os providers na ordem de
 * tentativa (o primeiro da lista e quem tenta primeiro; se falhar,
 * o proximo da lista e o failover).
 *
 * E assim que o requisito "alterna entre as duas APIs" + "se uma falhar,
 * tenta a outra automaticamente" fica resolvido ao mesmo tempo: a ordem
 * roda, mas o failover sempre acontece dentro da mesma chamada.
 */
@Injectable()
export class ProviderRotator {
  private index = 0;

  nextOrder<T>(items: readonly T[]): T[] {
    if (items.length === 0) return [];
    const start = this.index % items.length;
    this.index = (this.index + 1) % items.length;
    return [...items.slice(start), ...items.slice(0, start)];
  }
}
