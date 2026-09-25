/**
 * Single source of "now". Tests and the evaluation suite pin it so date math
 * is reproducible; production always uses the real clock.
 */
const g = globalThis as unknown as { __lifeosNow?: Date };

export function now(): Date {
  return g.__lifeosNow ? new Date(g.__lifeosNow) : new Date();
}

export function setClock(d: Date | null) {
  g.__lifeosNow = d ?? undefined;
}
