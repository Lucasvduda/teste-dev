import { calculateBackoffMs } from './backoff';

describe('calculateBackoffMs', () => {
  it('dobra o intervalo a cada tentativa (backoff exponencial)', () => {
    expect(calculateBackoffMs(1, 1000)).toBe(1000);
    expect(calculateBackoffMs(2, 1000)).toBe(2000);
    expect(calculateBackoffMs(3, 1000)).toBe(4000);
    expect(calculateBackoffMs(4, 1000)).toBe(8000);
  });

  it('funciona com bases diferentes', () => {
    expect(calculateBackoffMs(1, 250)).toBe(250);
    expect(calculateBackoffMs(3, 250)).toBe(1000);
  });

  it('devolve 0 para tentativa invalida (< 1)', () => {
    expect(calculateBackoffMs(0, 1000)).toBe(0);
    expect(calculateBackoffMs(-1, 1000)).toBe(0);
  });
});
