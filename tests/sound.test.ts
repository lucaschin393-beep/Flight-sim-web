import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { Rng } from '../src/rng';
import {
  ENGINES, RATE, makeBoom, makeEngineLayer, makeFire, makeGearMotor, makeJet, makeRoll, makeSnap, makeSplash,
  makeThunk, makeTouchdown, normalize,
} from '../src/soundgen';
import type { PistonLayer, TurbineLayer } from '../src/soundgen';

const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('generated sounds', () => {
  it('a boom is a bang that dies away and normalises to full scale', () => {
    const boom = makeBoom(new Rng(1), 1.0);
    expect(boom.length).toBe(RATE);
    expect(peak(boom.slice(0, 2000))).toBeGreaterThan(10 * peak(boom.slice(-500)));
    expect(peak(normalize(boom))).toBeCloseTo(1, 5);
  });

  it('fire, jet, gear motor and tyre loops join without a click', () => {
    for (const make of [makeFire, makeJet, makeRoll, makeGearMotor]) {
      const wave = make(new Rng(1), 1.0);
      expect(wave.length, make.name).toBe(RATE);
      expect(peak(wave), make.name).toBeGreaterThan(0.1);
      const step = Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(wave[i + 1] - wave[i])));
      expect(Math.abs(wave[0] - wave[wave.length - 1]), make.name).toBeLessThan(3 * Math.max(step, 0.05) + 0.5);
    }
  });

  it('one-shot effects have content', () => {
    for (const make of [makeThunk, makeSnap, makeSplash, makeTouchdown]) {
      const wave = make(new Rng(1));
      expect(wave.length, make.name).toBeGreaterThan(1000);
      expect(peak(wave), make.name).toBeGreaterThan(0.1);
    }
  });

  it('every aircraft has an engine with three seamless layers, and none whine', () => {
    for (const spec of AIRCRAFT) {
      const profile = ENGINES[spec.engine];
      expect(profile.layers.length).toBe(3);
      for (const layer of profile.layers) {
        const loop = makeEngineLayer(new Rng(1), profile.kind, layer);
        expect(loop.length).toBe(RATE);
        expect(peak(loop)).toBeGreaterThan(0.1);
        const step = Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(loop[i + 1] - loop[i])));
        expect(Math.abs(loop[0] - loop[loop.length - 1])).toBeLessThan(3 * Math.max(step, 0.05));
      }
    }
    for (const profile of Object.values(ENGINES)) {
      if (profile.kind === 'turbine') expect((profile.layers as TurbineLayer[]).every((l) => l.whine === 0)).toBe(true);
      else expect((profile.layers as PistonLayer[]).every((l) => l.f > 0)).toBe(true);
    }
  });
});
