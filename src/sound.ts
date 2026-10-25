/** Web Audio playback of the generated sounds. Everything quietly does nothing until unlocked. */
import { Rng } from './rng';
import {
  ENGINES, LAYER_GAIN, RATE, makeBoom, makeEngineLayer, makeFire, makeGearMotor, makeJet, makeRoll,
  makeSnap, makeSplash, makeThunk, makeTouchdown, normalize,
} from './soundgen';

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class Sounds {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loops = new Map<string, Loop>();
  private loopLevels = new Map<string, number>();
  private oneShots = new Set<AudioBufferSourceNode>();
  private fireLoop: Loop | null = null;
  private jetLoop: Loop | null = null;
  private jetLevel = 0;
  private engineName: string | null = null;
  private engineLoops: Loop[] = [];
  private engineLevels = [0, 0, 0];
  private prevGear: number | null = null;

  /** Browsers only allow audio after a key press or click: call this from one. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null; // no audio available
    }
  }

  get ok(): boolean {
    return this.ctx !== null && this.master !== null;
  }

  private buffer(name: string, make: () => Float32Array): AudioBuffer | null {
    if (!this.ctx) return null;
    let buf = this.buffers.get(name);
    if (!buf) {
      const data = normalize(make());
      buf = this.ctx.createBuffer(1, data.length, RATE);
      buf.getChannelData(0).set(data);
      this.buffers.set(name, buf);
    }
    return buf;
  }

  private rngFor(name: string): Rng {
    return new Rng([...name].reduce((s, c) => s + c.charCodeAt(0), 0));
  }

  private startLoop(buf: AudioBuffer, volume: number): Loop | null {
    if (!this.ctx || !this.master) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
    return { source, gain };
  }

  private stopLoop(loop: Loop | null): void {
    if (!loop) return;
    try { loop.source.stop(); } catch { /* already stopped */ }
    loop.source.disconnect();
    loop.gain.disconnect();
  }

  private playOnce(name: string, make: (rng: Rng) => Float32Array, volume: number): void {
    if (!this.ok || this.muted || !this.ctx || !this.master) return;
    const buf = this.buffer(name, () => make(this.rngFor(name)));
    if (!buf) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    this.oneShots.add(source);
    source.onended = () => { this.oneShots.delete(source); gain.disconnect(); };
    source.start();
  }

  /** Boom now and a crackling fire loop that fades as the wreck burns down; or a splash. */
  crash(intensity = 1, water = false): void {
    if (!this.ok || this.muted) return;
    const vol = Math.max(0.3, Math.min(1, intensity));
    if (water) {
      this.playOnce('splash', makeSplash, Math.max(0.35, vol));
      return;
    }
    this.playOnce('boom', makeBoom, vol);
    const buf = this.buffer('fire', () => makeFire(this.rngFor('fire')));
    this.stopLoop(this.fireLoop);
    this.fireLoop = buf ? this.startLoop(buf, 0) : null;
  }

  /** 0..1 loudness of the fire. */
  fireLevel(level: number): void {
    if (this.fireLoop) this.fireLoop.gain.gain.value = this.muted ? 0 : Math.max(0, Math.min(1, level)) * 0.7;
  }

  /** Jet roar following the afterburner flame: power 0 (silent) .. 1 (full), eased over time. */
  afterburner(power: number, dt: number): void {
    if (!this.ok) return;
    this.jetLevel += (power - this.jetLevel) * Math.min(1, 4 * dt);
    const audible = this.jetLevel > 0.01 && !this.muted;
    if (audible && !this.jetLoop) {
      const buf = this.buffer('jet', () => makeJet(this.rngFor('jet')));
      this.jetLoop = buf ? this.startLoop(buf, 0) : null;
    }
    if (this.jetLoop) this.jetLoop.gain.gain.value = audible ? this.jetLevel * 0.22 : 0;
  }

  /** Engine note for the current aircraft: idle / cruise / full-power loops cross-faded by throttle. */
  engine(name: string, throttle: number, dt: number, quiet = false): void {
    if (!this.ok || this.muted) return;
    const profile = ENGINES[name];
    if (name !== this.engineName || !this.engineLoops.length) {
      this.engineLoops.forEach((l) => this.stopLoop(l));
      this.engineLoops = profile.layers.map((params, i) => {
        const buf = this.buffer(`engine-${name}-${i}`, () => makeEngineLayer(this.rngFor(name + i), profile.kind, params));
        return buf ? this.startLoop(buf, 0) : null;
      }).filter((l): l is Loop => l !== null);
      this.engineName = name;
      this.engineLevels = [0, 0, 0];
    }
    const t = Math.max(0, Math.min(1, throttle));
    const weights = [Math.max(0, 1 - t / 0.5), Math.max(0, 1 - Math.abs(t - 0.5) / 0.5), Math.max(0, (t - 0.5) / 0.5)];
    const gain = quiet ? 0 : profile.gain;
    this.engineLoops.forEach((loop, i) => {
      const target = weights[i] * LAYER_GAIN[i] * gain;
      this.engineLevels[i] += (target - this.engineLevels[i]) * Math.min(1, 5 * dt);
      loop.gain.gain.value = this.engineLevels[i];
    });
  }

  /** Keep looped effect `name` at eased volume `target`; it only runs while audible. */
  private loop(name: string, make: (rng: Rng) => Float32Array, target: number, dt: number, rate = 8): void {
    let level = this.loopLevels.get(name) ?? 0;
    level += (target - level) * Math.min(1, rate * dt);
    this.loopLevels.set(name, level);
    const existing = this.loops.get(name);
    if (level > 0.01 && !this.muted) {
      if (!existing) {
        const buf = this.buffer(name, () => make(this.rngFor(name)));
        const created = buf ? this.startLoop(buf, level) : null;
        if (created) this.loops.set(name, created);
      } else {
        existing.gain.gain.value = level;
      }
    } else if (existing) {
      this.stopLoop(existing);
      this.loops.delete(name);
    }
  }

  /** Mechanical grind while the gear moves, and a clunk when it locks down or tucks up. */
  gear(gear: number, dt: number, quiet = false): void {
    if (!this.ok || this.muted) return;
    const prev = this.prevGear;
    this.prevGear = gear;
    const moving = gear > 0 && gear < 1 && prev !== null && gear !== prev;
    this.loop('gear_motor', makeGearMotor, quiet || !moving ? 0 : 0.22, dt);
    if (prev !== null && !quiet) {
      if ((prev < 1 && gear >= 1) || (prev > 0 && gear <= 0)) this.playOnce('gear_thunk', makeThunk, gear >= 1 ? 0.8 : 0.6);
    }
  }

  /**
   * Tyre rumble that grows with ground speed. `rolling` must mean the tyres are on the ground
   * (see Plane.wheelsRolling); it cuts off almost at once the moment they leave it.
   */
  wheels(rolling: boolean, speed: number, dt: number, quiet = false): void {
    if (!this.ok || this.muted) return;
    const target = rolling && !quiet ? Math.min(speed / 45, 1) * 0.45 : 0;
    this.loop('wheel_roll', makeRoll, target, dt, target ? 8 : 30);
  }

  wingSnap(): void {
    this.playOnce('wing_snap', makeSnap, 0.9);
  }

  /** Thump and tyre noise on a safe landing; a firmer landing is louder. */
  touchdown(sinkRate = 1): void {
    this.playOnce('touchdown', makeTouchdown, Math.max(0.35, Math.min(1, 0.35 + sinkRate / 6)));
  }

  /** Silence everything (on restart / map change). */
  stop(): void {
    this.stopLoop(this.fireLoop);
    this.stopLoop(this.jetLoop);
    this.fireLoop = this.jetLoop = null;
    this.jetLevel = 0;
    this.engineLoops.forEach((l) => this.stopLoop(l));
    this.engineLoops = [];
    this.engineName = null;
    this.loops.forEach((l) => this.stopLoop(l));
    this.loops.clear();
    this.loopLevels.clear();
    this.prevGear = null;
    this.oneShots.forEach((s) => { try { s.stop(); } catch { /* ended */ } });
    this.oneShots.clear();
  }

  pause(paused: boolean): void {
    if (!this.ctx) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    if (this.muted) this.stop();
    return this.muted;
  }
}
