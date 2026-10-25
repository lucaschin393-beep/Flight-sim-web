/**
 * Selectable maps: terrain colours, sky and where the seas and lakes are.
 *
 * Water is decided by a smooth "land height" field made of a few sine waves (plus an optional
 * slope for a coastline). Anywhere that field is below the map's sea level is water. The field is
 * always pushed up around the runway so the start is on land. Land/water is evaluated on a fixed
 * 100 m grid so what you see and what the physics uses always agree.
 */
import { Rng } from './rng';
import type { RGB } from './vec';

export const CELL = 100.0; // land/water grid, metres
export const TILE = 400.0; // a ground tile (4 x 4 cells)
const START_ZONE = [350.0, 1150.0] as const; // half sizes (x, z) kept dry around the runway

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Smooth pseudo-noise: a seeded sum of sine waves, roughly in -1.7 .. 1.7. */
class Waves {
  private readonly waves: [number, number, number, number][] = [];
  private readonly scale: number;

  constructor(seed: number, wavelength: number, stretch: readonly [number, number], count = 7) {
    const rng = new Rng(seed);
    for (let i = 0; i < count; i++) {
      const ang = rng.uniform(0, 2 * Math.PI);
      const k = (2 * Math.PI) / ((wavelength * rng.uniform(0.35, 1.6)) / (1 + 0.45 * i));
      this.waves.push([k * Math.cos(ang) * stretch[0], k * Math.sin(ang) * stretch[1],
        rng.uniform(0, 2 * Math.PI), 1 / (1 + 0.35 * i)]);
    }
    this.scale = 2 / this.waves.reduce((s, w) => s + w[3], 0);
  }

  at(x: number, z: number): number {
    let sum = 0;
    for (const [kx, kz, ph, a] of this.waves) sum += a * Math.sin(kx * x + kz * z + ph);
    return this.scale * sum;
  }
}

/** [colour, isWater] of one 100 m cell. */
export type Cell = readonly [RGB, boolean];

export interface MapOptions {
  level: number;
  wavelength?: number;
  stretch?: readonly [number, number];
  slope?: readonly [number, number];
  amp?: number;
  land?: readonly [RGB, RGB];
  sand?: RGB;
  shallow?: RGB;
  deep?: RGB;
  far?: RGB;
  skyTop?: RGB;
  horizon?: RGB;
  mountains?: number;
  buildings?: readonly [number, number];
  trees?: number;
  treeTint?: readonly [number, number, number];
  rock?: readonly [RGB, RGB];
  cap?: RGB;
}

export class GameMap {
  readonly level: number;
  readonly slope: readonly [number, number];
  readonly amp: number;
  readonly land: readonly [RGB, RGB];
  readonly sand: RGB;
  readonly shallow: RGB;
  readonly deep: RGB;
  readonly far: RGB;
  readonly skyTop: RGB;
  readonly horizon: RGB;
  readonly mountains: number;
  readonly buildings: readonly [number, number];
  readonly trees: number;
  readonly treeTint: readonly [number, number, number];
  readonly rock: readonly [RGB, RGB];
  readonly cap: RGB;
  private readonly noise: Waves;
  private readonly tiles = new Map<string, readonly Cell[]>();

  constructor(readonly name: string, readonly description: string, readonly seed: number, o: MapOptions) {
    this.level = o.level;
    this.slope = o.slope ?? [0, 0];
    this.amp = o.amp ?? 1.0;
    this.land = o.land ?? [[98, 150, 92], [90, 140, 84]];
    this.sand = o.sand ?? [214, 200, 150];
    this.shallow = o.shallow ?? [70, 150, 200];
    this.deep = o.deep ?? [30, 86, 150];
    this.far = o.far ?? [120, 156, 116];
    this.skyTop = o.skyTop ?? [70, 120, 200];
    this.horizon = o.horizon ?? [190, 214, 232];
    this.mountains = o.mountains ?? 0.4;
    this.buildings = o.buildings ?? [2, 5];
    this.trees = o.trees ?? 8;
    this.treeTint = o.treeTint ?? [40, 1.0, 55];
    this.rock = o.rock ?? [[118, 108, 96], [104, 96, 86]];
    this.cap = o.cap ?? [245, 247, 250];
    this.noise = new Waves(seed, o.wavelength ?? 3000.0, o.stretch ?? [1, 1]);
  }

  /** The land height field (arbitrary units); below `level` is water. */
  height(x: number, z: number): number {
    const d = Math.hypot(x / START_ZONE[0], z / START_ZONE[1]);
    const dry = 4.0 * smooth((1.9 - d) / 0.9); // forced land at the runway, easing off
    return this.noise.at(x, z) * this.amp + this.slope[0] * x + this.slope[1] * z + dry;
  }

  private cellCentre(ix: number, iz: number): [number, number] {
    return [(ix + 0.5) * CELL, (iz + 0.5) * CELL];
  }

  /** Whether the ground at (x, z) is water (decided per 100 m cell). */
  waterAt(x: number, z: number): boolean {
    const [cx, cz] = this.cellCentre(Math.floor(x / CELL), Math.floor(z / CELL));
    return this.height(cx, cz) < this.level;
  }

  hasWater(): boolean {
    return this.level > -50;
  }

  /** [colour, isWater] of one 100 m cell. */
  cell(ix: number, iz: number): Cell {
    const [x, z] = this.cellCentre(ix, iz);
    const h = this.height(x, z) - this.level;
    if (h < 0) return [h < -0.3 ? this.deep : this.shallow, true];
    if (h < 0.08) return [this.sand, false];
    return [this.land[(ix + iz) & 1], false];
  }

  /** Cells of the 400 m tile (tx, tz): one cell if uniform, else all 16 (row by row). */
  tile(tx: number, tz: number): readonly Cell[] {
    const key = `${tx},${tz}`;
    let cached = this.tiles.get(key);
    if (!cached) {
      if (this.tiles.size > 6000) this.tiles.clear();
      const n = TILE / CELL;
      const cells: Cell[] = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.push(this.cell(tx * n + i, tz * n + j));
      const same = cells.every((c) => c[0][0] === cells[0][0][0] && c[0][1] === cells[0][0][1] && c[0][2] === cells[0][0][2]);
      cached = same ? [cells[0]] : cells;
      this.tiles.set(key, cached);
    }
    return cached;
  }

  /** Share of the ground within `extent` metres of the runway that is water. */
  waterFraction(extent = 12000, step = 200): number {
    const n = Math.floor((2 * extent) / step);
    let wet = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) wet += this.waterAt(-extent + i * step, -extent + j * step) ? 1 : 0;
    return wet / (n * n);
  }
}

export const MAPS: GameMap[] = [
  new GameMap('Home Fields', 'The original: green plains, no water.', 7, { level: -99 }),
  new GameMap('Emerald Lakes', 'Green hills dotted with lakes.', 11, {
    level: -0.55, wavelength: 2600, land: [[88, 150, 84], [78, 138, 76]], mountains: 0.3, trees: 10,
    sand: [200, 196, 140], shallow: [74, 164, 190], deep: [28, 100, 140],
  }),
  new GameMap('Island Chain', 'A warm sea scattered with islands; the runway is on one.', 23, {
    level: 0.25, wavelength: 2300, amp: 1.1, land: [[118, 168, 92], [108, 158, 84]], sand: [232, 218, 160],
    shallow: [64, 190, 210], deep: [20, 110, 170], skyTop: [60, 130, 220], horizon: [196, 226, 240],
    far: [70, 160, 195], mountains: 0.2, buildings: [1, 3], trees: 9, treeTint: [30, 1.05, 50],
  }),
  new GameMap('Sunset Coast', 'Dry shores on the west, open ocean to the east, with a few ponds.', 37, {
    level: 0.0, wavelength: 2400, amp: 0.55, slope: [-0.0005, 0.0], land: [[196, 170, 112], [188, 160, 102]],
    sand: [230, 206, 150], shallow: [80, 150, 176], deep: [34, 82, 130], far: [176, 166, 130],
    skyTop: [220, 120, 80], horizon: [246, 196, 150], mountains: 0.35, buildings: [2, 4], trees: 4,
    treeTint: [118, 0.9, 52], rock: [[156, 112, 84], [140, 98, 74]], cap: [220, 190, 160],
  }),
  new GameMap('Frozen Fjords', 'Snowy highlands cut by long, dark fjords and mountain lakes.', 51, {
    level: -0.25, wavelength: 2800, stretch: [2.6, 0.7], land: [[236, 240, 246], [224, 230, 240]],
    sand: [202, 210, 220], shallow: [120, 170, 200], deep: [34, 70, 110], far: [196, 206, 220],
    skyTop: [96, 130, 190], horizon: [208, 220, 236], mountains: 0.7, buildings: [0, 2], trees: 10,
    treeTint: [30, 0.85, 70], rock: [[120, 124, 134], [104, 108, 120]], cap: [250, 252, 255],
  }),
];
