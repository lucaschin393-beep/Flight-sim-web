/** Simplified flight model: thrust, drag, gravity, lagged controls, coordinated turns. */
import * as cfg from './config';
import { AIRCRAFT } from './aircraft';
import type { Aircraft, WingSide } from './aircraft';
import type { Poly } from './meshes';
import { clamp, eulerBasis } from './vec';
import type { Vec3 } from './vec';

export const GRAVITY = 9.81;

export type CollisionResult = 'crash' | { wing: WingSide };

export class Plane {
  spec: Aircraft = AIRCRAFT[0];
  pos: Vec3 = cfg.START_POSITION;
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  throttle = 0.5;
  stalled = false;
  verticalSpeed = 0;
  propAngle = 0;
  brake = 0;
  onGround = false;
  wingLost: WingSide | null = null;
  gearDown = false; // selected position
  gear = 0; // actual position: 0 up .. 1 down
  private pitchCmd = 0;
  private rollCmd = 0;

  constructor() {
    this.reset();
  }

  /** Swap aircraft type in flight, keeping position and attitude. */
  setSpec(spec: Aircraft): void {
    this.spec = spec;
    this.wingLost = null; // a new aircraft has both wings
    this.speed = clamp(this.speed, 0, spec.maxSpeed * 1.5);
    this.pitch = clamp(this.pitch, -spec.maxPitch, spec.maxPitch);
    this.roll = clamp(this.roll, -spec.maxRoll, spec.maxRoll);
  }

  reset(): void {
    this.pos = cfg.START_POSITION;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = this.spec.startSpeed;
    this.throttle = 0.5;
    this.stalled = false;
    this.verticalSpeed = 0;
    this.propAngle = 0;
    this.brake = 0;
    this.onGround = false;
    this.wingLost = null;
    this.gearDown = false;
    this.gear = 0;
    this.pitchCmd = 0;
    this.rollCmd = 0;
  }

  /** Parked on the ground at `pos`, facing `yaw`, ready to taxi and take off. */
  resetAt(pos: Vec3, yaw: number): void {
    this.reset();
    this.pos = [pos[0], this.spec.groundClearance, pos[2]];
    this.yaw = yaw;
    this.speed = 0;
    this.throttle = 0;
    this.gearDown = true;
    this.gear = 1;
    this.onGround = true;
  }

  get gearLockedDown(): boolean {
    return this.gear >= 1;
  }

  /** True only when the tyres are really on the ground: down and locked, and at ground height. */
  get wheelsRolling(): boolean {
    return this.onGround && this.gearLockedDown && this.pos[1] <= this.spec.groundClearance + 0.3;
  }

  /** Raise/lower the gear. Returns false if refused (can't retract on the ground). */
  toggleGear(): boolean {
    if (this.onGround && this.gearDown) return false;
    this.gearDown = !this.gearDown;
    return true;
  }

  get basis(): [Vec3, Vec3, Vec3] {
    return eulerBasis(this.yaw, this.pitch, this.roll);
  }

  get altitude(): number {
    return this.pos[1];
  }

  get headingDegrees(): number {
    return (((this.yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  /** pitchIn: +1 nose up. rollIn: +1 bank right. throttleIn: +1 more. brakeIn: air brake held. */
  update(dt: number, pitchIn: number, rollIn: number, throttleIn: number, brakeIn = false): void {
    const sp = this.spec;
    this.throttle = clamp(this.throttle + throttleIn * cfg.THROTTLE_RATE * dt, 0, 1);

    const step = dt / cfg.GEAR_TIME;
    this.gear = clamp(this.gear + (this.gearDown ? step : -step), 0, 1);

    // Air brake extends smoothly; it fades out near the stall so it can't cause one.
    const target = brakeIn ? 1 : 0;
    this.brake += clamp(target - this.brake, -cfg.BRAKE_RATE * dt, cfg.BRAKE_RATE * dt);
    const brake = this.brake * clamp((this.speed - sp.stallSpeed * 1.05) / (sp.stallSpeed * 0.3), 0, 1);

    // Control surfaces lag the stick, and bite less in slow air.
    const lag = Math.min(1, cfg.CONTROL_LAG * dt);
    this.pitchCmd += (pitchIn - this.pitchCmd) * lag;
    this.rollCmd += (rollIn - this.rollCmd) * lag;
    const authority = clamp(this.speed / sp.controlSpeed, 0.25, 1.25);

    this.pitch += this.pitchCmd * sp.pitchRate * authority * dt;
    // A banked wing loses vertical lift, so the nose sags in a turn.
    this.pitch -= sp.bankNoseDrop * (1 - Math.cos(this.roll)) * dt;
    this.pitch = clamp(this.pitch, -sp.maxPitch, sp.maxPitch);
    if (this.onGround) { // the nose only lifts once there is enough airspeed
      this.pitch = this.speed >= sp.rotateSpeed ? Math.max(this.pitch, 0) : 0;
    }

    const aileron = this.wingLost ? cfg.WING_LOSS_AILERON : 1;
    this.roll = clamp(this.roll + this.rollCmd * sp.rollRate * authority * aileron * dt, -sp.maxRoll, sp.maxRoll);
    if (this.wingLost && !this.onGround) {
      // Lift is lost on the broken side, so the plane keeps rolling and turning toward it.
      const side = this.wingLost === 'left' ? -1 : 1;
      this.roll = clamp(this.roll + side * cfg.WING_LOSS_ROLL * dt, -sp.maxRoll, sp.maxRoll);
    } else if (rollIn === 0) { // dihedral effect: wings level themselves
      this.roll -= this.roll * Math.min(1, 0.35 * dt);
    }

    if (this.onGround) { // taxiing: steer with the nose wheel, wings stay level
      this.roll = 0;
      this.yaw += rollIn * cfg.TAXI_TURN_RATE * Math.min(this.speed / 8, 1) * dt;
    } else {
      // Coordinated turn: turn rate = g * tan(bank) / speed.
      const turn = (sp.turnFactor * GRAVITY * Math.tan(this.roll)) / Math.max(this.speed, 20);
      this.yaw += clamp(turn, -sp.maxTurnRate, sp.maxTurnRate) * dt;
    }

    // Speed: thrust - drag (grows with speed squared) - gravity along the flight path.
    let thrust = sp.idleThrust + this.throttle * (sp.maxThrust - sp.idleThrust);
    if (this.onGround) thrust = this.throttle * sp.maxThrust;
    const drag = sp.drag * (1 + cfg.BRAKE_DRAG * brake + cfg.GEAR_DRAG * this.gear);
    let accel = thrust - drag * this.speed ** 2 - GRAVITY * Math.sin(this.pitch);
    // Pulling g in a steep bank adds induced drag.
    accel -= cfg.INDUCED_DRAG * (1 / Math.max(Math.cos(this.roll), 0.2) - 1);
    if (this.onGround) accel -= cfg.GROUND_FRICTION + (brakeIn ? cfg.WHEEL_BRAKE : 0);
    const top = this.onGround ? cfg.MAX_GROUND_SPEED : sp.maxSpeed * 1.5;
    this.speed = clamp(this.speed + accel * dt, 0, top);

    this.propAngle += (12 + 40 * this.throttle) * dt;

    const [fwd] = this.basis;
    const x = this.pos[0] + fwd[0] * this.speed * dt;
    let y = this.pos[1] + fwd[1] * this.speed * dt;
    const z = this.pos[2] + fwd[2] * this.speed * dt;

    // Stall: lose lift and the nose drops.
    this.stalled = this.speed < sp.stallSpeed && !this.onGround;
    if (this.stalled) {
      y -= (sp.stallSpeed - this.speed) * 0.6 * dt;
      this.pitch = clamp(this.pitch - 0.6 * dt, -sp.maxPitch, sp.maxPitch);
    }

    if (this.onGround) {
      if (y > sp.groundClearance + 0.05) this.onGround = false; // wheels have left the ground
      else y = sp.groundClearance;
    }

    if (this.wingLost && !this.onGround) y -= cfg.WING_LOSS_SINK * dt;

    this.verticalSpeed = dt > 0 ? (y - this.pos[1]) / dt : 0;
    this.pos = [x, y, z];
  }

  /**
   * [index, world position] of the points standing for the plane's body, and wheels if down.
   * Indices count the body points first, then the wheel points. Points on a wing that has
   * already broken off are skipped.
   */
  collisionPoints(pos: Vec3 = this.pos): [number, Vec3][] {
    const [fwd, right, up] = this.basis;
    const sp = this.spec;
    const local: [number, Vec3][] = sp.hitPoints.map((p, i) => [i, p]);
    if (this.gear > 0.5) sp.gearHitPoints.forEach((p, i) => local.push([sp.hitPoints.length + i, p]));
    const out: [number, Vec3][] = [];
    for (const [i, p] of local) {
      const [x, y, z] = p;
      if (this.wingLost && i < sp.hitPoints.length && sp.isWingPoint(p) && sp.wingSide(p) === this.wingLost) continue;
      out.push([i, [
        pos[0] + right[0] * x + up[0] * y + fwd[0] * z,
        pos[1] + right[1] * x + up[1] * y + fwd[1] * z,
        pos[2] + right[2] * x + up[2] * y + fwd[2] * z]]);
    }
    return out;
  }

  /**
   * What hitting something with these collision points means: 'crash', or { wing: side } if only
   * one wing's outer part touched and that wing is still on. Touching anything but a wing, or
   * losing the second wing, is a crash.
   */
  collisionResult(indices: Iterable<number>): CollisionResult {
    const sp = this.spec;
    const sides = new Set<WingSide>();
    for (const i of indices) {
      if (i >= sp.hitPoints.length || !sp.isWingPoint(sp.hitPoints[i])) return 'crash';
      sides.add(sp.wingSide(sp.hitPoints[i]));
    }
    if (sides.size !== 1 || this.wingLost) return 'crash';
    return { wing: [...sides][0] };
  }

  /** Break the wing off. Returns its polygons in world space (to fall away as wreckage). */
  loseWing(side: WingSide): Poly[] {
    this.wingLost = side;
    return this.toWorld(this.spec.lostWingPolys[side]);
  }

  /** Plane-local polygons -> world space. */
  toWorld(polys: Poly[]): Poly[] {
    const [fwd, right, up] = this.basis;
    const [px, py, pz] = this.pos;
    const map = (p: Vec3): Vec3 => [
      px + right[0] * p[0] + up[0] * p[1] + fwd[0] * p[2],
      py + right[1] * p[0] + up[1] * p[1] + fwd[1] * p[2],
      pz + right[2] * p[0] + up[2] * p[1] + fwd[2] * p[2]];
    return polys.map(({ verts, color, normal: n }) => ({
      verts: verts.map(map),
      color,
      normal: n === null ? null : [
        right[0] * n[0] + up[0] * n[1] + fwd[0] * n[2],
        right[1] * n[0] + up[1] * n[1] + fwd[1] * n[2],
        right[2] * n[0] + up[2] * n[1] + fwd[2] * n[2]],
    }));
  }

  /** The plane's mesh transformed into world space. */
  worldPolys(flame = true): Poly[] {
    const { body, gear } = this.spec.parts(this.wingLost);
    let mesh = this.gear > 0.5 ? [...body, ...gear] : body;
    mesh = [...mesh, ...this.spec.propPolys(this.propAngle)];
    if (flame) mesh = [...mesh, ...this.spec.flamePolys(this.throttle, this.propAngle)];
    return this.toWorld(mesh);
  }
}
