/** Game state and the per-frame rules: flying, landing, crashing, wings, maps. No DOM or WebGL here. */
import { AIRCRAFT } from './aircraft';
import { FIRST_PERSON, GameCamera, VIEWS } from './camera';
import * as cfg from './config';
import { Explosion, LINGER, Piece, SMOULDER } from './explosion';
import type { Status } from './hud';
import { MAPS } from './maps';
import { Plane } from './plane';
import { Rng } from './rng';
import type { Sounds } from './sound';
import { clamp } from './vec';
import type { Vec3 } from './vec';
import { World } from './world';

export interface Controls {
  pitch: number; // +1 nose up
  roll: number; // +1 bank right
  throttle: number; // +1 more
  brake: boolean;
}

const RED = [255, 90, 80] as const;
const GREEN = [120, 230, 140] as const;

/** Called when the plane reaches the ground: landed safely or crashed. */
export function landingStatus(plane: Plane): Status {
  const gentle = plane.speed < plane.spec.landSpeed
    && Math.abs(plane.pitch) < cfg.LAND_MAX_ATTITUDE && Math.abs(plane.roll) < cfg.LAND_MAX_ATTITUDE
    && plane.verticalSpeed > -cfg.LAND_MAX_SINK;
  if (!plane.gearLockedDown) return { text: 'CRASHED - landing gear not down!', color: RED };
  if (gentle) return { text: 'Landed safely!', color: GREEN };
  return { text: 'CRASHED!', color: RED };
}

export class Game {
  mapIndex = 0;
  world = new World(undefined, MAPS[0]);
  readonly plane = new Plane();
  readonly camera = new GameCamera();
  viewIndex = 0;
  status: Status | null = null;
  paused = false;
  explosion: Explosion | null = null;
  wingPieces: Piece[] = [];
  private crashInWater = false;
  private landedAt: { pos: Vec3; yaw: number } | null = null;

  constructor(private readonly sounds: Sounds, private readonly notify: (text: string) => void) {}

  get view() {
    return VIEWS[this.viewIndex];
  }

  get firstPerson(): boolean {
    return this.view === FIRST_PERSON;
  }

  // -- player commands ----------------------------------------------------
  /** Load another map and start again at its runway (the aircraft type is kept). */
  switchMap(index: number): void {
    this.mapIndex = ((index % MAPS.length) + MAPS.length) % MAPS.length;
    this.world = new World(undefined, MAPS[this.mapIndex]);
    this.plane.reset();
    this.camera.snapNextUpdate();
    this.status = null;
    this.paused = false;
    this.explosion = null;
    this.wingPieces = [];
    this.landedAt = null;
    this.crashInWater = false;
    this.sounds.stop();
    this.notify(`Map: ${this.world.map.name}`);
  }

  cycleView(): void {
    this.viewIndex = (this.viewIndex + 1) % VIEWS.length;
    this.camera.snapNextUpdate();
  }

  selectAircraft(index: number | 'next'): void {
    if (this.status !== null) return;
    const i = index === 'next' ? (AIRCRAFT.indexOf(this.plane.spec) + 1) % AIRCRAFT.length : index;
    if (i < 0 || i >= AIRCRAFT.length) return;
    this.plane.setSpec(AIRCRAFT[i]);
    this.camera.snapNextUpdate();
  }

  toggleGear(): void {
    if (this.status !== null) return;
    if (!this.plane.toggleGear()) this.notify("Can't raise the landing gear on the ground");
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.sounds.pause(this.paused);
  }

  /** Restart: after a safe landing carry on from where you touched down, otherwise start over. */
  restart(): void {
    if (this.landedAt && this.status && this.status.text.startsWith('Landed')) {
      this.plane.resetAt(this.landedAt.pos, this.landedAt.yaw);
    } else {
      this.plane.reset();
    }
    this.camera.snapNextUpdate();
    this.status = null;
    this.explosion = null;
    this.wingPieces = [];
    this.crashInWater = false;
    this.sounds.stop();
    this.paused = false;
  }

  // -- the frame ----------------------------------------------------------
  update(dt: number, input: Controls): void {
    const { plane, world, sounds } = this;
    if (this.status === null && !this.paused) {
      const prevPos = plane.pos;
      plane.update(dt, input.pitch, input.roll, input.throttle, input.brake);

      const hits = world.hitIndices(plane, prevPos);
      let outcome = hits.size ? plane.collisionResult(hits) : null;
      if (outcome && outcome !== 'crash') { // clipped a wing: it breaks off
        const velocity = plane.basis[0].map((c) => c * plane.speed) as unknown as Vec3;
        const broken = new Piece(plane.loseWing(outcome.wing), plane.pos, velocity, new Rng(), 0.35, 0.9,
          { drag: 1.0, burn: false, waterAt: (x, z) => world.waterAt(x, z) });
        broken.spin = broken.spin.map((c) => c * 2) as unknown as Vec3;
        this.wingPieces.push(broken);
        sounds.wingSnap();
        outcome = null;
      }
      const inWater = world.waterAt(plane.pos[0], plane.pos[2]);
      const touching = plane.onGround || plane.altitude <= plane.spec.groundClearance;
      if (outcome === 'crash') {
        this.status = { text: 'CRASHED!', color: RED };
      } else if (inWater && touching) {
        this.status = { text: 'CRASHED - hit the water!', color: RED };
        this.crashInWater = true;
      } else if (!plane.onGround && plane.altitude <= plane.spec.groundClearance) {
        this.status = landingStatus(plane);
        if (!this.status.text.startsWith('CRASHED')) {
          plane.pos = [plane.pos[0], plane.spec.groundClearance, plane.pos[2]];
          this.landedAt = { pos: plane.pos, yaw: plane.yaw };
          sounds.touchdown(-plane.verticalSpeed);
        }
      }
    }

    if (this.explosion === null && this.status && this.status.text.startsWith('CRASHED')) {
      const velocity = plane.basis[0].map((c) => c * plane.speed) as unknown as Vec3;
      this.explosion = new Explosion(plane.pos, velocity, {
        scale: plane.spec.boundingRadius / 5.5,
        polys: plane.worldPolys(false),
        intensity: clamp(plane.speed / 60, 0.35, 1.3),
        water: this.crashInWater,
        waterAt: (x, z) => world.waterAt(x, z),
        waterColor: world.map.shallow,
      });
      sounds.crash(plane.speed / 60, this.crashInWater);
      this.viewIndex = 0; // watch it from outside, in 3rd person
      this.camera.snapNextUpdate();
    }
    if (!this.paused) {
      for (const piece of this.wingPieces) piece.update(dt);
      if (this.explosion) {
        this.explosion.update(dt);
        // fire roars while the wreck burns hard, then dies down as it smoulders
        const e = this.explosion;
        const rampIn = Math.min(e.age / 0.6, 1);
        const burnDown = e.age < LINGER ? 1 : Math.max(0, (SMOULDER - e.age) / (SMOULDER - LINGER));
        sounds.fireLevel(rampIn * (0.25 + 0.75 * burnDown));
      }
    }

    const quiet = this.paused || this.status !== null;
    sounds.engine(plane.spec.engine, plane.throttle, dt, quiet);
    sounds.gear(plane.gear, dt, quiet);
    sounds.wheels(plane.wheelsRolling, plane.speed, dt, quiet);
    sounds.afterburner(quiet ? 0 : plane.spec.exhaustPower(plane.throttle), dt);

    // After a crash the camera drifts back so the whole explosion is in view.
    const back = this.explosion ? 1 + 3 * Math.min(1, this.explosion.age / 1.5) : 1;
    this.camera.follow(plane, this.view, this.paused ? 0 : dt, back);
  }

  /** The camera jolt from a blast (zero otherwise). */
  shake(): Vec3 {
    return this.explosion && !this.paused ? this.explosion.cameraShake() : [0, 0, 0];
  }
}
