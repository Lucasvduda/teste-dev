export const WEBHOOK_SLEEP_FN = 'WEBHOOK_SLEEP_FN';

export type SleepFn = (ms: number) => Promise<void>;

/** Implementacao real (usada em produção). Testes injetam um sleep instantaneo. */
export const realSleep: SleepFn = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
