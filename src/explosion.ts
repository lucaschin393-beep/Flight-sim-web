/**
 * Crash explosion logic: a flash, a fireball, flying debris, smoke, a wreck that breaks into
 * tumbling pieces, and a splash when it hits water. Pure simulation: sceneview.ts draws it.
 */
import type { Poly } from './meshes';
import { Rng } from './rng';
import type { RGB, Vec3 } from './vec';

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

export const LINGER = 6.0; // seconds the wreck burns fiercely
export const SMOULDER = 25.0; // seconds it keeps smoking

const FIRE: [number, RGB][] = [[0.0, [255, 246, 190]], [0.3, [255, 180, 50]], [0.65, [220, 70, 25]], [1.0, [60, 44, 40]]];
const DEBRIS_COLORS: RGB[] = [[236, 236, 240], [196, 44, 44], [60, 62, 68], [30, 30, 34], [140, 140, 150]];

/** Colour along a gradient of [position, colour] stops. */
export function ramp(stops: [number, RGB][], t: number): RGB {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (c <= t1) {
      const k = (c - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.floor(c0[j] + (c1[j] - c0[j]) * k)) as unknown as RGB;
    }
  }
  return stops[stops.length - 1][1];
}

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r as Mat3;
};

/** Rotation matrix about `axis` (any length) by `angle`. */
function axisAngle(axis: Vec3, angle: number): Mat3 {
  const n = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2) || 1;
  const [x, y, z] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}

export const applyMat = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Split a mesh into `count` roughly spatially-compact groups of polygons. */
export function cluster(polys: Poly[], count: number, rng: Rng): Poly[][] {
  const cents: Vec3[] = polys.map((p) => [0, 1, 2].map((i) => p.verts.reduce((s, v) => s + v[i], 0) / p.verts.length) as unknown as Vec3);
  const seeds = [rng.randrange(polys.length)];
  let nearest = cents.map((c) => dist3(c, cents[seeds[0]]));
  while (seeds.length < Math.min(count, polys.length)) {
    const i = nearest.reduce((best, d, k) => (d > nearest[best] ? k : best), 0);
    seeds.push(i);
    nearest = nearest.map((d, k) => Math.min(d, dist3(cents[k], cents[i])));
  }
  const groups: Poly[][] = seeds.map(() => []);
  polys.forEach((poly, n) => {
    let best = 0;
    for (let k = 1; k < seeds.length; k++) if (dist3(cents[n], cents[seeds[k]]) < dist3(cents[n], cents[seeds[best]])) best = k;
    groups[best].push(poly);
  });
  return groups;
}

export interface PieceOptions {
  drag?: number;
  burn?: boolean;
  waterAt?: ((x: number, z: number) => boolean) | null;
}

/** A chunk of the broken plane: a rigid group of polygons that tumbles and lands. */
export class Piece {
  center: Vec3;
  /** Polygons relative to `center`, in the piece's own (unrotated) frame. */
  readonly rel: Poly[];
  readonly radius: number;
  vel: Vec3;
  spin: Vec3;
  rot: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  bounces = 0;
  resting = false;
  age = 0;
  burning: boolean;
  sinking = false;
  sunk = false;
  readonly drag: number;
  readonly burn: boolean;
  private readonly waterAt: ((x: number, z: number) => boolean) | null;

  constructor(polys: Poly[], origin: Vec3, velocity: Vec3, rng: Rng, intensity: number, inherit: number,
              opts: PieceOptions = {}) {
    const verts = polys.flatMap((p) => p.verts);
    this.center = [0, 1, 2].map((i) => verts.reduce((s, v) => s + v[i], 0) / verts.length) as unknown as Vec3;
    const c = this.center;
    this.rel = polys.map((p) => ({
      verts: p.verts.map((v) => [v[0] - c[0], v[1] - c[1], v[2] - c[2]] as Vec3), color: p.color, normal: p.normal,
    }));
    this.radius = Math.max(...verts.map((v) => dist3(v, c)));
    const out: Vec3 = [c[0] - origin[0], c[1] - origin[1] + 1.5, c[2] - origin[2]];
    const n = Math.hypot(...out) || 1;
    const speed = rng.uniform(6, 28) * intensity;
    this.vel = [0, 1, 2].map((i) => velocity[i] * inherit + (out[i] / n) * speed) as unknown as Vec3;
    this.spin = [0, 1, 2].map(() => rng.uniform(-1, 1) * rng.uniform(1.5, 6.0) * intensity) as unknown as Vec3;
    this.drag = opts.drag ?? 0;
    this.burn = opts.burn ?? true;
    this.burning = this.burn && rng.random() < 0.5;
    this.waterAt = opts.waterAt ?? null;
  }

  private tumble(dt: number): void {
    const w = Math.hypot(...this.spin);
    if (w > 1e-6) this.rot = mul(axisAngle(this.spin, w * dt), this.rot);
  }

  update(dt: number): void {
    this.age += dt;
    if (this.resting) return;
    if (this.sinking) { // settling slowly under the surface
      const [cx, cy, cz] = this.center;
      const [vx, , vz] = this.vel;
      const damp = Math.max(0, 1 - 2 * dt);
      this.vel = [vx * damp, 0, vz * damp];
      this.center = [cx + vx * dt, cy - 2.2 * dt, cz + vz * dt];
      this.tumble(dt);
      if (cy < -this.radius * 1.2) this.sunk = this.resting = true;
      return;
    }
    let [vx, vy, vz] = this.vel;
    vy -= 24 * dt;
    if (this.drag) { // air slows a light, flat wing
      const damp = Math.max(0, 1 - this.drag * dt);
      vx *= damp;
      vz *= damp;
    }
    const [cx, cy, cz] = this.center;
    this.center = [cx + vx * dt, cy + vy * dt, cz + vz * dt];
    this.vel = [vx, vy, vz];
    this.tumble(dt);
    let low = Infinity;
    for (const p of this.rel) for (const v of p.verts) low = Math.min(low, applyMat(this.rot, v)[1]);
    low += this.center[1];
    if (low < 0 && this.waterAt && this.waterAt(this.center[0], this.center[2])) { // splashes down
      this.sinking = true;
      this.spin = this.spin.map((c) => c * 0.3) as unknown as Vec3;
      this.vel = [this.vel[0] * 0.3, 0, this.vel[2] * 0.3];
    } else if (low < 0) { // hit the ground
      this.center = [this.center[0], this.center[1] - low, this.center[2]];
      const [wx, wy, wz] = this.vel;
      this.bounces += 1;
      if (this.bounces >= 3 || Math.abs(wy) < 3) {
        this.resting = true;
        this.vel = [0, 0, 0];
        this.spin = [0, 0, 0];
      } else {
        this.vel = [wx * 0.6, -wy * 0.3, wz * 0.6];
        this.spin = this.spin.map((c) => c * 0.5) as unknown as Vec3;
      }
    }
  }

  /** 0 = fresh paint .. 0.8 = charred. A wing that just broke off isn't burning. */
  get soot(): number {
    return this.burn ? Math.min(this.age / 4, 1) * 0.8 : 0;
  }

  /** The images of the piece's local x, y and z axes in world space (the columns of `rot`). */
  get axes(): [Vec3, Vec3, Vec3] {
    const r = this.rot;
    return [[r[0][0], r[1][0], r[2][0]], [r[0][1], r[1][1], r[2][1]], [r[0][2], r[1][2], r[2][2]]];
  }

  /** The piece's polygons in world space (used by the tests). */
  polys(): Poly[] {
    if (this.sunk) return [];
    const soot = this.soot;
    return this.rel.map((p) => ({
      verts: p.verts.map((v) => {
        const w = applyMat(this.rot, v);
        return [this.center[0] + w[0], this.center[1] + w[1], this.center[2] + w[2]] as Vec3;
      }),
      color: p.color.map((c) => Math.floor(c * (1 - soot) + 34 * soot)) as unknown as RGB,
      normal: p.normal ? applyMat(this.rot, p.normal) : null,
    }));
  }
}

export type ParticleKind = 'fire' | 'smoke' | 'debris' | 'spray' | 'mist';

export interface Particle {
  pos: Vec3;
  vel: Vec3;
  age: number;
  life: number;
  radius: number;
  kind: ParticleKind;
  color: RGB | null;
}

/** Size (metres), colour and opacity (0..1) a particle is drawn with. */
export function particleLook(p: Particle): { radius: number; color: RGB; alpha: number } {
  const t = p.age / p.life;
  switch (p.kind) {
    case 'debris': return { radius: p.radius, color: p.color ?? [60, 60, 60], alpha: 1 };
    case 'spray': return { radius: p.radius * (1 - 0.3 * t), color: [226, 240, 250], alpha: (235 * (1 - t * t)) / 255 };
    case 'mist': return { radius: p.radius * (1 + 1.2 * t), color: [205, 222, 236], alpha: (110 * (1 - t)) / 255 };
    case 'fire': return { radius: p.radius * (0.6 + 0.8 * t), color: ramp(FIRE, t), alpha: 1 };
    default: {
      const shade = Math.floor(40 + 50 * t);
      return { radius: p.radius * (1 + 1.6 * t), color: [shade, shade, shade], alpha: (170 * (1 - t)) / 255 };
    }
  }
}

export interface ExplosionOptions {
  scale?: number;
  rng?: Rng;
  polys?: Poly[] | null;
  intensity?: number;
  water?: boolean;
  waterAt?: ((x: number, z: number) => boolean) | null;
  waterColor?: RGB;
}

export class Explosion {
  readonly rng: Rng;
  readonly pos: Vec3;
  readonly velocity: Vec3;
  readonly scale: number;
  readonly intensity: number;
  readonly water: boolean;
  readonly waterColor: RGB;
  age = 0;
  particles: Particle[] = [];
  readonly pieces: Piece[] = [];
  /** Irregular scorch outline, as [x, z] offsets in units of the blast size. */
  readonly scorch: [number, number][];

  /**
   * `polys`: the plane's world-space mesh, broken into tumbling wreckage.
   * `intensity` (~0.3 slow bump .. 1.3 high-speed impact) scales the blast.
   */
  constructor(pos: Vec3, velocity: Vec3, o: ExplosionOptions = {}) {
    this.rng = o.rng ?? new Rng();
    this.pos = [pos[0], Math.max(pos[1], 1), pos[2]];
    this.velocity = [velocity[0] * 0.3, velocity[1] * 0.3, velocity[2] * 0.3]; // wreckage keeps some momentum
    this.scale = Math.max(o.scale ?? 1, 1);
    this.intensity = o.intensity ?? 1;
    this.water = o.water ?? false;
    this.waterColor = o.waterColor ?? [40, 100, 160];
    const k = this.intensity;
    if (this.water) { // a splash and spray instead of a fireball
      for (let i = 0; i < Math.floor(90 * k); i++) this.spawn('spray', [10, 45 * k], [0.8, 2.0], [1.2, 3.5]);
      for (let i = 0; i < 24; i++) this.spawn('mist', [2, 9], [1.5, 3.2], [3.0, 7.0]);
      for (let i = 0; i < Math.floor(14 * k); i++) this.spawn('debris', [10, 35 * k], [2.0, 3.5], [0.35, 0.8]);
    } else {
      for (let i = 0; i < Math.floor(70 * k); i++) this.spawn('fire', [8, 40 * k], [0.6, 1.6], [2.5, 6.0 * k]);
      for (let i = 0; i < 40; i++) this.spawn('smoke', [3, 18], [2.5, 5.5], [2.0, 4.5]);
      for (let i = 0; i < Math.floor(40 * k); i++) this.spawn('debris', [20, 65 * k], [3.0, 5.0], [0.35, 0.9]);
    }
    if (o.polys && o.polys.length) {
      for (const group of cluster(o.polys, 16, this.rng)) {
        if (group.length) {
          this.pieces.push(new Piece(group, this.pos, velocity, this.rng, k, 0.45,
            { burn: !this.water, waterAt: o.waterAt ?? null }));
        }
      }
    }
    this.scorch = [];
    for (let i = 0; i < 14; i++) {
      const r = this.rng.uniform(0.7, 1.3);
      this.scorch.push([Math.cos((2 * Math.PI * i) / 14) * r, Math.sin((2 * Math.PI * i) / 14) * r]);
    }
  }

  private spawn(kind: ParticleKind, speed: [number, number], life: [number, number], radius: [number, number],
                jitter = 1, at?: Vec3): void {
    const r = this.rng, s = this.scale;
    const origin = at ?? this.pos;
    const a = r.uniform(0, 2 * Math.PI), b = r.uniform(-0.3, 1.0); // biased upwards
    const sq = Math.sqrt(1 - b * b);
    const d: Vec3 = [Math.cos(a) * sq, b, Math.sin(a) * sq];
    const v = r.uniform(speed[0], speed[1]) * s ** 0.5;
    this.particles.push({
      pos: [0, 1, 2].map((i) => origin[i] + r.uniform(-1, 1) * jitter * s) as unknown as Vec3,
      vel: [0, 1, 2].map((i) => this.velocity[i] + d[i] * v) as unknown as Vec3,
      age: 0,
      life: r.uniform(life[0], life[1]),
      radius: r.uniform(radius[0], radius[1]) * s,
      kind,
      color: kind === 'debris' ? r.choice(DEBRIS_COLORS) : null,
    });
  }

  get done(): boolean {
    return this.age > (this.water ? 9.0 : SMOULDER + 6.0);
  }

  update(dt: number): void {
    this.age += dt;
    const r = this.rng;
    if (this.water) {
      // no fire on the water
    } else if (this.age < LINGER) { // the wreck keeps burning
      if (r.random() < 60 * dt) this.spawn('fire', [1, 6], [0.5, 1.1], [1.0, 2.2], 0.8);
      if (r.random() < 35 * dt) this.spawn('smoke', [1, 4], [3.0, 5.0], [1.5, 3.0], 0.8);
    } else if (this.age < SMOULDER && r.random() < 6 * dt) {
      this.spawn('smoke', [0.5, 2], [4.0, 7.0], [1.2, 2.4], 1.2);
    }
    for (const piece of this.pieces) {
      piece.update(dt);
      if (piece.burning && piece.age < 6 && r.random() < 10 * dt) {
        this.spawn('smoke', [0.5, 3], [1.5, 3.0], [0.6, 1.4], 0.2, piece.center);
      }
    }
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      let [x, y, z] = p.pos;
      let [vx, vy, vz] = p.vel;
      if (p.kind === 'spray') { // water thrown up falls back
        vy -= 22 * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (y < 0.2) continue;
      } else if (p.kind === 'debris') {
        vy -= 28 * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (y <= p.radius) { // lands and skids to a stop
          y = p.radius;
          vy = 0;
          vx *= 0.85;
          vz *= 0.85;
        }
      } else {
        const rise = p.kind === 'smoke' ? 9 : 5;
        const damp = Math.max(0, 1 - 1.8 * dt);
        vx *= damp; vz *= damp; vy = vy * damp + rise * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        y = Math.max(y, p.radius * 0.3);
      }
      p.pos = [x, y, z];
      p.vel = [vx, vy, vz];
      alive.push(p);
    }
    this.particles = alive;
  }

  /** How strongly the white-out flash is showing, 1 -> 0 over the first third of a second. */
  get flash(): number {
    return this.age < 0.35 ? 1 - this.age / 0.35 : 0;
  }

  wreckagePolys(): Poly[] {
    return this.pieces.flatMap((p) => p.polys());
  }

  /**
   * Scorch mark that grows then stays, plus a brief expanding dust ring: flat polygons.
   * On water: a few ripple rings of foam spreading out and fading instead.
   */
  groundDecals(): Poly[] {
    const [x, , z] = this.pos;
    const size = 12 * this.scale * this.intensity;
    if (this.water) return this.ripples(x, z, size);
    const grow = Math.min(this.age / 0.6, 1);
    const out: Poly[] = [{
      verts: this.scorch.map(([px, pz]) => [x + px * size * grow, 0.12, z + pz * size * grow] as Vec3),
      color: [38, 46, 36], normal: null,
    }];
    if (this.age < 1.1) {
      const r0 = size * 3.2 * this.age, r1 = r0 + size * 0.5;
      const fade = this.age / 1.1;
      const color = [[196, 90], [184, 88], [160, 84]].map(([a, b]) => Math.floor(a + (b - a) * fade)) as unknown as RGB;
      out.push(...ring(x, z, r0, r1, color));
    }
    return out;
  }

  private ripples(x: number, z: number, size: number): Poly[] {
    const out: Poly[] = [];
    for (let k = 0; k < 4; k++) { // rings leave one after another
      const t = this.age - k * 0.45;
      if (t > 0 && t < 3.2) {
        const r0 = size * 0.9 * t;
        const fade = t / 3.2;
        const foam = [232, 242, 250];
        const color = foam.map((a, i) => Math.floor(a + (this.waterColor[i] - a) * fade)) as unknown as RGB;
        out.push(...ring(x, z, r0, r0 + size * 0.22, color, 24));
      }
    }
    return out;
  }

  /** Offset for the camera: a hard jolt that dies away over ~0.9 s. */
  cameraShake(): Vec3 {
    let k = Math.max(0, 1 - this.age / 0.9) ** 2 * 1.6 * this.scale ** 0.5 * this.intensity;
    k *= this.water ? 0.5 : 1;
    return [0, 1, 2].map(() => this.rng.uniform(-1, 1) * k) as unknown as Vec3;
  }
}

function ring(x: number, z: number, r0: number, r1: number, color: RGB, segments = 20): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (2 * Math.PI * i) / segments, a1 = (2 * Math.PI * (i + 1)) / segments;
    out.push({
      verts: [[a0, r0], [a1, r0], [a1, r1], [a0, r1]].map(([a, r]) => [x + Math.cos(a) * r, 0.14, z + Math.sin(a) * r] as Vec3),
      color, normal: null,
    });
  }
  return out;
}
