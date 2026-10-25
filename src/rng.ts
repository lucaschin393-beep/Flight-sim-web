/** Small seeded random number generator (mulberry32) with the helpers the game needs. */
export class Rng {
  private state: number;

  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  /** Integer in [lo, hi] inclusive. */
  randint(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  /** Integer in [0, n). */
  randrange(n: number): number {
    return Math.floor(this.random() * n);
  }

  choice<T>(items: readonly T[]): T {
    return items[this.randrange(items.length)];
  }
}

/** Mix several integers into one 32-bit seed. */
export function hashSeed(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= Math.floor(p) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
