/** Procedurally generated world: runway, mountains, buildings and trees, on top of a map. */
import { MAPS } from './maps';
import type { GameMap } from './maps';
import { box, cone } from './meshes';
import type { Poly } from './meshes';
import type { Plane } from './plane';
import { Rng, hashSeed } from './rng';
import type { RGB, Vec3 } from './vec';

export const CHUNK = 1600.0;
export const LOAD_RADIUS = 2;
export const RUNWAY_HALF_WIDTH = 30.0;
export const RUNWAY_HALF_LENGTH = 800.0;

export interface Obj {
  polys: Poly[];
  center: Vec3;
  radius: number;
  hit?: (p: Vec3) => boolean;
}

/** Flat ground decals (the runway and its centre line): unlit polygons. */
export function runwayPolys(): Poly[] {
  const w = RUNWAY_HALF_WIDTH, l = RUNWAY_HALF_LENGTH;
  const out: Poly[] = [{
    verts: [[-w, 0.05, -l], [w, 0.05, -l], [w, 0.05, l], [-w, 0.05, l]], color: [64, 66, 72], normal: null,
  }];
  for (let z = -l + 40; z < l - 40; z += 80) {
    out.push({
      verts: [[-1.5, 0.1, z], [1.5, 0.1, z], [1.5, 0.1, z + 40], [-1.5, 0.1, z + 40]],
      color: [240, 240, 235], normal: null,
    });
  }
  return out;
}

function mountain(rng: Rng, x: number, z: number, rock: readonly [RGB, RGB], cap: RGB): Obj {
  const radius = rng.uniform(300, 700);
  const height = rng.uniform(250, 600);
  const body = cone(x, 0, z, radius, height, 8, rock);
  const capH = height * 0.28;
  const snow = cone(x, height - capH, z, radius * 0.28 * 1.04, capH * 1.01, 8, [cap]);
  return {
    polys: [...body, ...snow],
    center: [x, height / 2, z],
    radius: Math.hypot(radius, height),
    hit: (p) => {
      const r = Math.hypot(p[0] - x, p[2] - z);
      return r < radius && p[1] < height * (1 - r / radius);
    },
  };
}

const BUILDING_COLORS: RGB[] = [[170, 170, 176], [196, 180, 150], [150, 160, 175], [180, 120, 110]];

function building(rng: Rng, x: number, z: number): Obj {
  const sx = rng.uniform(20, 60), sz = rng.uniform(20, 60);
  const h = rng.uniform(25, 140);
  const color = rng.choice(BUILDING_COLORS);
  return {
    polys: box(x, h / 2, z, sx, h, sz, color),
    center: [x, h / 2, z],
    radius: Math.hypot(sx, sz, h),
    hit: (p) => Math.abs(p[0] - x) < sx / 2 && Math.abs(p[2] - z) < sz / 2 && p[1] < h,
  };
}

function tree(rng: Rng, x: number, z: number, tint: readonly [number, number, number]): Obj {
  const h = rng.uniform(10, 22);
  const g = rng.randint(80, 130);
  const base = h * 0.35;
  const colors: RGB[] = [
    [tint[0], Math.min(255, Math.floor(g * tint[1])), tint[2]],
    [tint[0] - 10, Math.min(255, Math.floor((g - 15) * tint[1])), tint[2] - 10],
  ];
  return {
    polys: cone(x, 0, z, base, h, 4, colors),
    center: [x, h / 2, z],
    radius: h,
    hit: (p) => p[1] >= 0 && p[1] < h && Math.hypot(p[0] - x, p[2] - z) < base * (1 - p[1] / h),
  };
}

export class World {
  readonly map: GameMap;
  readonly seed: number;
  readonly runway: Poly[] = runwayPolys();
  private chunks = new Map<string, Obj[]>();

  constructor(seed?: number, map?: GameMap) {
    this.map = map ?? MAPS[0];
    this.seed = seed ?? this.map.seed;
  }

  waterAt(x: number, z: number): boolean {
    return this.map.waterAt(x, z);
  }

  private generate(cx: number, cz: number): Obj[] {
    const rng = new Rng(hashSeed(this.seed, cx, cz));
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const m = this.map;
    const objs: Obj[] = [];

    /** A random dry spot away from the runway, or null if none was found. */
    const spot = (): [number, number] | null => {
      for (let i = 0; i < 30; i++) {
        const x = x0 + rng.uniform(0, CHUNK), z = z0 + rng.uniform(0, CHUNK);
        if ((Math.abs(x) > 140 || Math.abs(z) > RUNWAY_HALF_LENGTH + 200) && !m.waterAt(x, z)) return [x, z];
      }
      return null;
    };

    if (rng.random() < m.mountains) {
      const s = spot();
      if (s) objs.push(mountain(rng, s[0], s[1], m.rock, m.cap));
    }
    const nb = rng.randint(m.buildings[0], m.buildings[1]);
    for (let i = 0; i < nb; i++) {
      const s = spot();
      if (s) objs.push(building(rng, s[0], s[1]));
    }
    for (let i = 0; i < m.trees; i++) {
      const s = spot();
      if (s) objs.push(tree(rng, s[0], s[1], m.treeTint));
    }
    return objs;
  }

  /** The objects of chunk (cx, cz), generated on first use. */
  chunk(cx: number, cz: number): Obj[] {
    const key = `${cx},${cz}`;
    let objs = this.chunks.get(key);
    if (!objs) {
      objs = this.generate(cx, cz);
      this.chunks.set(key, objs);
    }
    return objs;
  }

  nearbyObjects(pos: Vec3): Obj[] {
    const ccx = Math.floor(pos[0] / CHUNK), ccz = Math.floor(pos[2] / CHUNK);
    if (this.chunks.size > 80) { // keep memory bounded
      for (const key of [...this.chunks.keys()]) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.abs(kx - ccx) > LOAD_RADIUS + 1 || Math.abs(kz - ccz) > LOAD_RADIUS + 1) this.chunks.delete(key);
      }
    }
    const out: Obj[] = [];
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) out.push(...this.chunk(ccx + dx, ccz + dz));
    }
    return out;
  }

  /**
   * Indices (see Plane.collisionPoints) of plane points inside a mountain, building or tree.
   * Also tests halfway along the last step so fast planes can't skip through thin trees.
   */
  hitIndices(plane: Plane, prevPos?: Vec3): Set<number> {
    const reach = plane.spec.boundingRadius;
    const spots: Vec3[] = prevPos
      ? [[(prevPos[0] + plane.pos[0]) / 2, (prevPos[1] + plane.pos[1]) / 2, (prevPos[2] + plane.pos[2]) / 2], plane.pos]
      : [plane.pos];
    const hits = new Set<number>();
    for (const spot of spots) {
      let points: [number, Vec3][] | null = null;
      for (const obj of this.nearbyObjects(spot)) {
        if (!obj.hit) continue;
        const d = Math.hypot(obj.center[0] - spot[0], obj.center[1] - spot[1], obj.center[2] - spot[2]);
        if (d > obj.radius + reach) continue;
        points ??= plane.collisionPoints(spot);
        for (const [i, p] of points) if (obj.hit(p)) hits.add(i);
      }
    }
    return hits;
  }

  hitsPlane(plane: Plane, prevPos?: Vec3): boolean {
    return this.hitIndices(plane, prevPos).size > 0;
  }
}
