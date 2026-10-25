/** The selectable aircraft: handling numbers, mesh and camera settings for each. */
import * as cfg from './config';
import {
  airlinerMesh, biplaneMesh, exhaustFlame, jetMesh, propeller as makePropeller, trainerMesh,
} from './meshes';
import type { Model, Poly } from './meshes';
import type { Vec3 } from './vec';

export type WingSide = 'left' | 'right';

/** `count` well-spread vertices of a mesh (farthest-point sampling) to stand for its shape. */
export function samplePoints(polys: Poly[], count: number): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const p of polys) {
    for (const v of p.verts) {
      const r: Vec3 = [Math.round(v[0] * 10) / 10, Math.round(v[1] * 10) / 10, Math.round(v[2] * 10) / 10];
      seen.set(r.join(','), r);
    }
  }
  const pool = [...seen.values()];
  if (!pool.length) return [];
  const argmax = (xs: number[]) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);
  const first = argmax(pool.map((v) => Math.hypot(v[0], v[1], v[2])));
  const chosen: Vec3[] = [pool[first]];
  let nearest = pool.map((v) => Math.hypot(v[0] - pool[first][0], v[1] - pool[first][1], v[2] - pool[first][2]));
  while (chosen.length < Math.min(count, pool.length)) {
    const i = argmax(nearest);
    chosen.push(pool[i]);
    nearest = nearest.map((d, k) =>
      Math.min(d, Math.hypot(pool[k][0] - pool[i][0], pool[k][1] - pool[i][1], pool[k][2] - pool[i][2])));
  }
  return chosen;
}

export interface AircraftOptions {
  model: Model;
  propeller?: ((angle: number) => Poly[]) | null;
  minSpeed: number;
  maxSpeed: number;
  stallSpeed: number;
  drag: number;
  landSpeed: number;
  groundClearance?: number;
  chaseDistance?: number;
  chaseHeight?: number;
  eye?: readonly [number, number];
  /** [z, y, radius] of a jet nozzle that shows a flame. */
  exhaust?: readonly [number, number, number] | null;
  engine?: EngineName;
  /** [min |x|, min z, max z] of a wing in plane-local coordinates. */
  wingZone?: readonly [number, number, number];
  pitchRate?: number;
  rollRate?: number;
  controlSpeed?: number;
  bankNoseDrop?: number;
  turnFactor?: number;
  maxTurnRate?: number;
  maxPitch?: number;
  maxRoll?: number;
}

export type EngineName = 'prop' | 'radial' | 'jet' | 'airliner';

/** Handling and look of one plane type. Unset numbers fall back to config.ts. */
export class Aircraft {
  readonly name: string;
  readonly mesh: Poly[];
  readonly gearMesh: Poly[];
  readonly propeller: ((angle: number) => Poly[]) | null;
  readonly minSpeed: number;
  readonly maxSpeed: number;
  readonly stallSpeed: number;
  readonly drag: number;
  readonly landSpeed: number;
  readonly groundClearance: number;
  readonly chaseDistance: number;
  readonly chaseHeight: number;
  readonly eye: readonly [number, number];
  readonly exhaust: readonly [number, number, number] | null;
  readonly engine: EngineName;
  readonly wingZone: readonly [number, number, number];
  readonly pitchRate: number;
  readonly rollRate: number;
  readonly controlSpeed: number;
  readonly bankNoseDrop: number;
  readonly turnFactor: number;
  readonly maxTurnRate: number;
  readonly maxPitch: number;
  readonly maxRoll: number;
  readonly idleThrust: number;
  readonly maxThrust: number;
  readonly startSpeed: number;
  readonly hitPoints: Vec3[];
  readonly gearHitPoints: Vec3[];
  readonly boundingRadius: number;
  /** Polygons of each wing (and anything bolted to it) in plane-local coordinates. */
  readonly lostWingPolys: Record<WingSide, Poly[]>;
  private readonly variants: Record<string, { body: Poly[]; gear: Poly[] }>;

  constructor(name: string, o: AircraftOptions) {
    this.name = name;
    this.mesh = o.model.body;
    this.gearMesh = o.model.gear;
    this.propeller = o.propeller ?? null;
    this.minSpeed = o.minSpeed;
    this.maxSpeed = o.maxSpeed;
    this.stallSpeed = o.stallSpeed;
    this.drag = o.drag;
    this.landSpeed = o.landSpeed;
    this.groundClearance = o.groundClearance ?? 1.0;
    this.chaseDistance = o.chaseDistance ?? 20.0;
    this.chaseHeight = o.chaseHeight ?? 6.0;
    this.eye = o.eye ?? [0.9, 2.2];
    this.exhaust = o.exhaust ?? null;
    this.engine = o.engine ?? 'prop';
    this.wingZone = o.wingZone ?? [1.6, -1.5, 1.3];
    this.pitchRate = o.pitchRate ?? cfg.PITCH_RATE;
    this.rollRate = o.rollRate ?? cfg.ROLL_RATE;
    this.controlSpeed = o.controlSpeed ?? cfg.CONTROL_SPEED;
    this.bankNoseDrop = o.bankNoseDrop ?? cfg.BANK_NOSE_DROP;
    this.turnFactor = o.turnFactor ?? cfg.TURN_FACTOR;
    this.maxTurnRate = o.maxTurnRate ?? cfg.MAX_TURN_RATE;
    this.maxPitch = o.maxPitch ?? cfg.MAX_PITCH;
    this.maxRoll = o.maxRoll ?? cfg.MAX_ROLL;
    // Thrust is chosen so level flight settles at minSpeed (idle) / maxSpeed (full throttle).
    this.idleThrust = this.drag * this.minSpeed ** 2;
    this.maxThrust = this.drag * this.maxSpeed ** 2;
    this.startSpeed = (this.minSpeed + this.maxSpeed) / 2;

    // Points that stand for the plane's body (incl. propeller) and its wheels, for collisions.
    const spinning = [...this.propPolys(0), ...this.propPolys(Math.PI / 2)];
    this.hitPoints = samplePoints([...this.mesh, ...spinning], 40);
    this.gearHitPoints = samplePoints(this.gearMesh, 12);
    this.boundingRadius = Math.max(
      ...[...this.hitPoints, ...this.gearHitPoints].map((p) => Math.hypot(p[0], p[1], p[2])));

    // The same meshes with one wing removed, for a broken-off wing.
    this.variants = { none: { body: this.mesh, gear: this.gearMesh } };
    const lost = {} as Record<WingSide, Poly[]>;
    for (const side of ['left', 'right'] as const) {
      const [keepBody, goneBody] = this.splitWing(this.mesh, side);
      const [keepGear, goneGear] = this.splitWing(this.gearMesh, side);
      this.variants[side] = { body: keepBody, gear: keepGear };
      lost[side] = [...goneBody, ...goneGear];
    }
    this.lostWingPolys = lost;
  }

  /** Speed at which the nose can be raised to leave the ground. */
  get rotateSpeed(): number {
    return this.stallSpeed * 1.1;
  }

  /** Whether a plane-local point lies on a wing (and not on the fuselage or tail). */
  isWingPoint(p: Vec3): boolean {
    const [xMin, zMin, zMax] = this.wingZone;
    return Math.abs(p[0]) >= xMin && p[2] >= zMin && p[2] <= zMax;
  }

  wingSide(p: Vec3): WingSide {
    return p[0] > 0 ? 'right' : 'left';
  }

  private splitWing(polys: Poly[], side: WingSide): [Poly[], Poly[]] {
    const keep: Poly[] = [];
    const gone: Poly[] = [];
    for (const poly of polys) {
      const c: Vec3 = [0, 1, 2].map((i) => poly.verts.reduce((s, v) => s + v[i], 0) / poly.verts.length) as unknown as Vec3;
      (this.isWingPoint(c) && this.wingSide(c) === side ? gone : keep).push(poly);
    }
    return [keep, gone];
  }

  /** (body mesh, gear mesh), without the lost wing if there is one. */
  parts(lostWing: WingSide | null = null): { body: Poly[]; gear: Poly[] } {
    return this.variants[lostWing ?? 'none'];
  }

  /** 0..1 strength of the afterburner (flame and roar); 0 for aircraft without one. */
  exhaustPower(throttle: number): number {
    return this.exhaust ? Math.max(0, (throttle - 0.3) / 0.7) : 0;
  }

  flamePolys(throttle: number, t: number): Poly[] {
    return this.exhaust ? exhaustFlame(throttle, t, this.exhaust[0], this.exhaust[1], this.exhaust[2]) : [];
  }

  propPolys(angle: number): Poly[] {
    return this.propeller ? this.propeller(angle) : [];
  }
}

export const AIRCRAFT: Aircraft[] = [
  new Aircraft('Skylark trainer', {
    model: trainerMesh(), propeller: (a) => makePropeller(a),
    minSpeed: cfg.MIN_SPEED, maxSpeed: cfg.MAX_SPEED, stallSpeed: cfg.STALL_SPEED, drag: cfg.DRAG, landSpeed: 55.0,
  }),
  new Aircraft('Barnstormer biplane', {
    model: biplaneMesh(), propeller: (a) => makePropeller(a, 3.4, 1.1),
    engine: 'radial', wingZone: [1.3, -1.3, 1.2],
    minSpeed: 22.0, maxSpeed: 70.0, stallSpeed: 18.0, drag: 0.0007, landSpeed: 40.0,
    eye: [1.0, 1.2], pitchRate: 1.0, rollRate: 2.0, controlSpeed: 40.0, turnFactor: 2.4, maxTurnRate: 1.1,
  }),
  new Aircraft('Falcon jet', {
    model: jetMesh(),
    minSpeed: 45.0, maxSpeed: 220.0, stallSpeed: 40.0, drag: 0.00025, landSpeed: 70.0,
    exhaust: [-5.25, 0.05, 0.42], engine: 'jet', wingZone: [1.4, -3.6, 0.7], groundClearance: 1.2,
    chaseDistance: 28.0, chaseHeight: 7.0, eye: [0.9, 2.6],
    pitchRate: 1.0, rollRate: 3.0, controlSpeed: 90.0, turnFactor: 1.8, maxTurnRate: 1.0, maxRoll: 1.5,
  }),
  new Aircraft('Atlas airliner', {
    model: airlinerMesh(), engine: 'airliner', wingZone: [3.0, -8.5, 3.6],
    minSpeed: 50.0, maxSpeed: 140.0, stallSpeed: 40.0, drag: 0.0003, landSpeed: 62.0,
    groundClearance: 3.4, chaseDistance: 60.0, chaseHeight: 16.0, eye: [2.2, 14.0],
    pitchRate: 0.45, rollRate: 0.7, controlSpeed: 80.0, bankNoseDrop: 0.3,
    turnFactor: 1.0, maxTurnRate: 0.35, maxPitch: 0.6, maxRoll: 0.9,
  }),
];
