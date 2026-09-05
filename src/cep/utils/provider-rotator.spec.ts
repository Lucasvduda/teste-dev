import { ProviderRotator } from './provider-rotator';

describe('ProviderRotator', () => {
  it('devolve lista vazia se nao houver providers', () => {
    const rotator = new ProviderRotator();
    expect(rotator.nextOrder([])).toEqual([]);
  });

  it('alterna o provider inicial a cada chamada (round-robin)', () => {
    const rotator = new ProviderRotator();
    const providers = ['A', 'B'];

    expect(rotator.nextOrder(providers)).toEqual(['A', 'B']);
    expect(rotator.nextOrder(providers)).toEqual(['B', 'A']);
    expect(rotator.nextOrder(providers)).toEqual(['A', 'B']);
  });

  it('funciona com 3+ providers, sempre devolvendo todos em ordem circular', () => {
    const rotator = new ProviderRotator();
    const providers = ['A', 'B', 'C'];

    expect(rotator.nextOrder(providers)).toEqual(['A', 'B', 'C']);
    expect(rotator.nextOrder(providers)).toEqual(['B', 'C', 'A']);
    expect(rotator.nextOrder(providers)).toEqual(['C', 'A', 'B']);
    expect(rotator.nextOrder(providers)).toEqual(['A', 'B', 'C']);
  });
});
