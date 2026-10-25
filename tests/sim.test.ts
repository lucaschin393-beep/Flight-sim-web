import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { FIRST_PERSON, GameCamera, THIRD_PERSON } from '../src/camera';
import * as cfg from '../src/config';
import { Explosion, Piece } from '../src/explosion';
import { landingStatus } from '../src/game';
import { CELL, MAPS } from '../src/maps';
import { Plane } from '../src/plane';
import { Rng } from '../src/rng';
import { cross, dot, eulerBasis, length } from '../src/vec';
import { World } from '../src/world';

function fly(plane: Plane, seconds: number, pitch = 0, roll = 0, throttle = 0, brake = false, dt = 1 / 60): void {
  for (let i = 0; i < Math.floor(seconds / dt); i++) plane.update(dt, pitch, roll, throttle, brake);
}

describe('vectors', () => {
  it('basis is orthonormal and right = up x forward', () => {
    for (const [yaw, pitch, roll] of [[0, 0, 0], [1.0, 0.4, -0.7], [-2.0, -0.9, 1.2]]) {
      const [f, r, u] = eulerBasis(yaw, pitch, roll);
      for (const v of [f, r, u]) expect(length(v)).toBeCloseTo(1, 6);
      expect(dot(f, r)).toBeCloseTo(0, 6);
      expect(dot(f, u)).toBeCloseTo(0, 6);
      cross(u, f).forEach((a, i) => expect(a).toBeCloseTo(r[i], 6));
    }
  });

  it('banking right drops the right wing', () => {
    const [, right] = eulerBasis(0, 0, 0.5);
    expect(right[1]).toBeLessThan(0);
  });
});

describe('flight model', () => {
  it('level flight holds altitude and moves forward', () => {
    const p = new Plane();
    fly(p, 3);
    expect(Math.abs(p.altitude - cfg.START_POSITION[1])).toBeLessThan(1);
    expect(p.pos[2]).toBeGreaterThan(cfg.START_POSITION[2] + 100);
  });

  it('nose up climbs and nose down descends', () => {
    const up = new Plane(), down = new Plane();
    fly(up, 2, 1);
    fly(down, 2, -1);
    expect(up.altitude).toBeGreaterThan(cfg.START_POSITION[1] + 20);
    expect(down.altitude).toBeLessThan(cfg.START_POSITION[1] - 20);
  });

  it('banking right turns right', () => {
    const p = new Plane();
    fly(p, 1, 0, 1);
    const yaw = p.yaw;
    fly(p, 2);
    expect(p.yaw).toBeGreaterThan(yaw);
    expect(p.headingDegrees).toBeGreaterThan(0);
  });

  it('a steep climb stalls and the nose drops', () => {
    const p = new Plane();
    let stalledAt: number | null = null;
    for (let i = 0; i < 60 * 30; i++) {
      p.update(1 / 60, 1, 0, 0);
      if (p.stalled && stalledAt === null) stalledAt = p.pitch;
    }
    expect(stalledAt).not.toBeNull();
    expect(p.pitch).toBeLessThan(cfg.MAX_PITCH);
  });

  it('throttle changes speed', () => {
    const slow = new Plane(), fast = new Plane();
    fly(slow, 15, 0, 0, -1);
    fly(fast, 15, 0, 0, 1);
    expect(slow.speed).toBeLessThan(fast.speed);
    expect(fast.throttle).toBe(1);
    expect(slow.throttle).toBe(0);
  });

  it('reset restores the start', () => {
    const p = new Plane();
    fly(p, 2, 1, 1);
    p.reset();
    expect([...p.pos]).toEqual([...cfg.START_POSITION]);
    expect([p.yaw, p.pitch, p.roll]).toEqual([0, 0, 0]);
  });

  it('the air brake slows faster without stalling', () => {
    const free = new Plane(), braked = new Plane();
    fly(free, 6, 0, 0, -1);
    fly(braked, 6, 0, 0, -1, true);
    expect(braked.speed).toBeLessThan(free.speed - 5);
    const long = new Plane();
    fly(long, 60, 0, 0, -1, true);
    expect(long.speed).toBeGreaterThan(cfg.STALL_SPEED);
  });
});

describe('camera', () => {
  it('first person looks where the plane points', () => {
    const cam = new GameCamera(), p = new Plane();
    cam.follow(p, FIRST_PERSON, 1 / 60);
    p.basis[0].forEach((v, i) => expect(cam.fwd[i]).toBeCloseTo(v, 6));
  });

  it('third person sits behind and above, and can back off', () => {
    const cam = new GameCamera(), p = new Plane();
    cam.follow(p, THIRD_PERSON, 1 / 60);
    expect(cam.pos[2]).toBeLessThan(p.pos[2] - 10);
    expect(cam.pos[1]).toBeGreaterThan(p.pos[1]);
    const near = p.pos[2] - cam.pos[2];
    cam.snapNextUpdate();
    cam.follow(p, THIRD_PERSON, 1 / 60, 3);
    expect(p.pos[2] - cam.pos[2]).toBeGreaterThan(near * 2);
  });
});

describe('world', () => {
  it('generation is deterministic', () => {
    const a = new World(3).nearbyObjects([100, 50, 100]);
    const b = new World(3).nearbyObjects([100, 50, 100]);
    expect(a.length).toBe(b.length);
    expect(a[0].center).toEqual(b[0].center);
  });

  it('the runway is clear of obstacles', () => {
    const w = new World();
    const p = new Plane();
    p.yaw = p.pitch = p.roll = 0;
    for (let z = -800; z <= 800; z += 50) {
      p.pos = [0, 60, z];
      expect(w.hitsPlane(p)).toBe(false);
    }
  });

  it('buildings are solid', () => {
    const w = new World();
    const b = w.nearbyObjects([0, 0, 0]).find((o) => o.hit && o.polys.length === 6)!;
    const [cx, cy, cz] = b.center;
    expect(b.hit!([cx, 1, cz])).toBe(true);
    expect(b.hit!([cx, cy * 2 + 50, cz])).toBe(false);
  });
});

describe('aircraft', () => {
  it('every aircraft flies level and has geometry', () => {
    for (const spec of AIRCRAFT) {
      const p = new Plane();
      p.setSpec(spec);
      p.reset();
      fly(p, 2);
      expect(Math.abs(p.altitude - cfg.START_POSITION[1]), spec.name).toBeLessThan(1);
      expect(p.worldPolys().length, spec.name).toBeGreaterThan(50);
    }
  });

  it('the jet outruns the biplane', () => {
    const speeds: Record<string, number> = {};
    for (const spec of AIRCRAFT) {
      const p = new Plane();
      p.setSpec(spec);
      fly(p, 40, 0, 0, 1);
      speeds[spec.name] = p.speed;
    }
    expect(speeds['Falcon jet']).toBeGreaterThan(2 * speeds['Barnstormer biplane']);
  });

  it('switching keeps the position', () => {
    const p = new Plane();
    fly(p, 1);
    const pos = [...p.pos];
    p.setSpec(AIRCRAFT[2]);
    expect([...p.pos]).toEqual(pos);
  });

  it('only the jet has an afterburner, and it grows with throttle', () => {
    const jet = AIRCRAFT[2], trainer = AIRCRAFT[0];
    expect(trainer.flamePolys(1, 0)).toEqual([]);
    expect(jet.flamePolys(0.1, 0)).toEqual([]);
    const tail = (t: number) => Math.min(...jet.flamePolys(t, 0).flatMap((p) => p.verts.map((v) => v[2])));
    expect(tail(1)).toBeLessThan(tail(0.6) - 1);
    expect(tail(0.6)).toBeLessThan(-5.25);
    expect(trainer.exhaustPower(1)).toBe(0);
    expect(jet.exhaustPower(1)).toBeCloseTo(1);
  });
});

describe('landing gear and ground', () => {
  it('the gear takes time and unlocks landing', () => {
    const p = new Plane();
    expect(p.gearLockedDown).toBe(false);
    p.toggleGear();
    fly(p, 0.5);
    expect(p.gearLockedDown).toBe(false);
    fly(p, 2);
    expect(p.gearLockedDown).toBe(true);
    p.toggleGear();
    fly(p, 2.5);
    expect(p.gear).toBe(0);
  });

  it('restarting on the ground works and the plane can take off', () => {
    const p = new Plane();
    p.resetAt([100, 0, 200], 1);
    expect(p.onGround).toBe(true);
    expect([p.pos[0], p.pos[2], p.yaw, p.speed]).toEqual([100, 200, 1, 0]);
    fly(p, 3);
    expect(p.speed).toBe(0);
    for (let i = 0; i < 60 * 30; i++) {
      p.update(1 / 60, p.speed > p.spec.rotateSpeed ? 1 : 0, 0, 1);
      if (!p.onGround) break;
    }
    expect(p.onGround).toBe(false);
    expect(p.stalled).toBe(false);
  });

  it('cannot rotate below rotate speed, cannot retract on the ground, and ground speed is capped', () => {
    const p = new Plane();
    p.resetAt([0, 0, 0], 0);
    fly(p, 2, 1);
    expect(p.pitch).toBe(0);
    expect(p.onGround).toBe(true);
    expect(p.toggleGear()).toBe(false);
    fly(p, 60, 0, 0, 1);
    expect(p.onGround).toBe(true);
    expect(p.speed * 3.6).toBeLessThanOrEqual(300 + 1e-6);
  });

  it('tyres only roll on the ground with the gear down', () => {
    const p = new Plane();
    expect(p.wheelsRolling).toBe(false);
    p.toggleGear();
    fly(p, 3);
    expect(p.wheelsRolling).toBe(false); // gear down but flying
    const q = new Plane();
    q.resetAt([0, 0, 0], 0);
    expect(q.wheelsRolling).toBe(true);
    for (let i = 0; i < 60 * 30 && q.onGround; i++) q.update(1 / 60, q.speed > q.spec.rotateSpeed ? 1 : 0, 0, 1);
    expect(q.wheelsRolling).toBe(false);
  });

  it('landing needs the gear down and a gentle touchdown', () => {
    const p = new Plane();
    p.speed = 30;
    p.verticalSpeed = -1;
    expect(landingStatus(p).text).toContain('gear not down');
    p.gear = 1;
    expect(landingStatus(p).text).toBe('Landed safely!');
    p.speed = 200;
    expect(landingStatus(p).text).toBe('CRASHED!');
  });
});

describe('collisions and wings', () => {
  const tree = (w: World) => w.nearbyObjects([0, 0, 0]).find((o) => o.hit && o.polys.length === 4 && o.radius < 30)!;

  it('classifies wing points by side and makes anything else a crash', () => {
    const sp = AIRCRAFT[0];
    const idx = (side: 'left' | 'right') => sp.hitPoints.map((q, i) => [q, i] as const)
      .filter(([q]) => sp.isWingPoint(q) && sp.wingSide(q) === side).map(([, i]) => i);
    const left = idx('left'), right = idx('right');
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    const p = new Plane();
    expect(p.collisionResult(right)).toEqual({ wing: 'right' });
    expect(p.collisionResult([...left, ...right])).toBe('crash');
    const body = sp.hitPoints.findIndex((q) => !sp.isWingPoint(q));
    expect(p.collisionResult([body])).toBe('crash');
    expect(p.collisionResult([...right, body])).toBe('crash');
  });

  it('a wing comes off, the missing wing cannot hit things, and the second wing is fatal', () => {
    const sp = AIRCRAFT[0];
    const p = new Plane();
    const before = p.worldPolys().length;
    const gone = p.loseWing('left');
    expect(gone.length).toBeGreaterThan(5);
    expect(p.worldPolys().length).toBe(before - gone.length);
    expect(gone.every((poly) => poly.verts[0][0] < 0)).toBe(true);
    const live = new Set(p.collisionPoints().map(([i]) => i));
    sp.hitPoints.forEach((q, i) => { if (sp.isWingPoint(q) && sp.wingSide(q) === 'left') expect(live.has(i)).toBe(false); });
    const right = sp.hitPoints.map((q, i) => [q, i] as const).filter(([q]) => sp.isWingPoint(q) && sp.wingSide(q) === 'right').map(([, i]) => i);
    expect(p.collisionResult(right)).toBe('crash');
  });

  it('the plane keeps turning toward the missing wing', () => {
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
      const p = new Plane();
      p.loseWing(side);
      const start = p.yaw;
      fly(p, 4);
      expect(p.roll * sign).toBeGreaterThan(0.8);
      expect((p.yaw - start) * sign).toBeGreaterThan(0.3);
      expect(p.speed).toBeGreaterThan(0);
    }
  });

  it('a clipped wingtip breaks the wing', () => {
    const w = new World();
    const p = new Plane();
    p.yaw = p.pitch = p.roll = 0;
    p.pos = [3000, 400, 3000]; // well above every tree, building and (almost) every mountain
    expect(w.hitIndices(p).size).toBe(0);
    const tip = p.spec.hitPoints.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(tip[0]).toBeGreaterThan(4);
    // a small pole standing exactly where the right wingtip is
    const at: [number, number, number] = [p.pos[0] + tip[0], p.pos[1] + tip[1], p.pos[2] + tip[2]];
    w.chunk(Math.floor(at[0] / 1600), Math.floor(at[2] / 1600)).push({
      polys: [], center: at, radius: 3, hit: (q) => Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]) < 1.5 });
    const hits = w.hitIndices(p);
    expect(hits.size).toBeGreaterThan(0);
    expect(p.collisionResult(hits)).toEqual({ wing: 'right' });
    p.pos = [3000 - 40, 400, 3000];
    expect(w.hitsPlane(p)).toBe(false);
  });

  it('a fast plane cannot skip through a tree', () => {
    const w = new World();
    const t = tree(w);
    const [x, , z] = t.center;
    const jet = new Plane();
    jet.setSpec(AIRCRAFT[2]);
    jet.pos = [x, 5, z - 1];
    expect(w.hitsPlane(jet, [x, 5, z - 5])).toBe(true);
  });
});

describe('explosions', () => {
  it('spawns debris, burns, then finishes', () => {
    const ex = new Explosion([0, 0, 0], [0, 0, 50], { rng: new Rng(1) });
    expect(ex.particles.length).toBeGreaterThan(100);
    for (let i = 0; i < 60 * 40; i++) ex.update(1 / 60);
    expect(ex.done).toBe(true);
    expect(ex.particles).toEqual([]);
  });

  it('the plane breaks into pieces that land and stay', () => {
    const p = new Plane();
    p.pos = [0, 30, 0];
    const polys = p.worldPolys();
    const ex = new Explosion(p.pos, [0, 0, 60], { rng: new Rng(2), polys, intensity: 1 });
    expect(ex.pieces.length).toBeGreaterThanOrEqual(8);
    expect(ex.pieces.reduce((n, pc) => n + pc.rel.length, 0)).toBe(polys.length);
    for (let i = 0; i < 60 * 15; i++) ex.update(1 / 60);
    expect(ex.pieces.every((pc) => pc.resting)).toBe(true);
    for (const poly of ex.wreckagePolys()) expect(poly.verts.every((v) => v[1] > -0.01)).toBe(true);
    expect(ex.groundDecals().length).toBeGreaterThan(0);
  });

  it('wreckage sinks in water and the splash leaves ripples', () => {
    const ex = new Explosion([0, 3, 0], [0, 0, 40], {
      rng: new Rng(3), polys: new Plane().worldPolys(), water: true, waterAt: () => true });
    for (let i = 0; i < 60 * 12; i++) ex.update(1 / 60);
    expect(ex.pieces.every((pc) => pc.sunk)).toBe(true);
    expect(ex.wreckagePolys()).toEqual([]);
    expect(ex.done).toBe(true);
    const fresh = new Explosion([0, 3, 0], [0, 0, 40], { rng: new Rng(3), water: true });
    fresh.age = 1;
    expect(fresh.groundDecals().length).toBeGreaterThan(0);
  });

  it('a broken-off wing is a piece that falls away', () => {
    const p = new Plane();
    p.pos = [0, 50, 0];
    const wing = new Piece(p.loseWing('left'), p.pos, [0, 0, 60], new Rng(4), 0.35, 0.9, { drag: 1, burn: false });
    for (let i = 0; i < 60 * 10; i++) wing.update(1 / 60);
    expect(wing.resting).toBe(true);
    expect(wing.soot).toBe(0);
  });
});

describe('maps', () => {
  it('there are five maps and the four new ones have water', () => {
    expect(MAPS.length).toBe(5);
    expect(MAPS[0].hasWater()).toBe(false);
    for (const m of MAPS.slice(1)) {
      const frac = m.waterFraction(9000, 300);
      expect(frac, m.name).toBeGreaterThan(0.1);
      expect(frac, m.name).toBeLessThan(0.8);
    }
    expect(new Set(MAPS.map((m) => m.name)).size).toBe(5);
  });

  it('the runway and start are always dry', () => {
    for (const m of MAPS) {
      for (let x = -300; x <= 300; x += 50) for (let z = -1100; z <= 1100; z += 50) expect(m.waterAt(x, z), `${m.name} ${x},${z}`).toBe(false);
    }
  });

  it('drawn tiles agree with the physics', () => {
    const m = MAPS[2];
    for (let tx = -4; tx <= 4; tx++) {
      for (let tz = 4; tz < 12; tz++) {
        const cells = m.tile(tx, tz);
        if (cells.length === 1) expect(cells[0][1]).toBe(m.waterAt(tx * 400 + 200, tz * 400 + 200));
        else cells.forEach((cell, k) => expect(cell[1]).toBe(m.waterAt(tx * 400 + (k % 4) * CELL + CELL / 2, tz * 400 + Math.floor(k / 4) * CELL + CELL / 2)));
      }
    }
  });

  it('nothing is built in the water', () => {
    const w = new World(undefined, MAPS[2]);
    let count = 0;
    for (const o of w.nearbyObjects([0, 50, 0])) {
      if (o.hit && o.radius < 200) {
        count += 1;
        expect(w.waterAt(o.center[0], o.center[2])).toBe(false);
      }
    }
    expect(count).toBeGreaterThan(10);
  });
});
