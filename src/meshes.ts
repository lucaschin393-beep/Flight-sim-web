/** Low-poly shape builders. A polygon is { verts, color, normal }; normal is null for unlit polygons. */
import { cross, dot, normalize, sub } from './vec';
import type { RGB, Vec3 } from './vec';

export interface Poly {
  verts: Vec3[];
  color: RGB;
  normal: Vec3 | null;
}

type Pair = readonly [number, number];
type ColorFn = (k: number, i: number) => RGB;

/** Build a polygon whose normal points away from `center`. */
export function orientedPoly(verts: Vec3[], color: RGB, center: Vec3): Poly {
  let n = normalize(cross(sub(verts[1], verts[0]), sub(verts[2], verts[0])));
  const c = [0, 1, 2].map((i) => verts.reduce((s, v) => s + v[i], 0) / verts.length);
  if (dot(n, [c[0] - center[0], c[1] - center[1], c[2] - center[2]]) < 0) {
    n = [-n[0], -n[1], -n[2]];
  }
  return { verts, color, normal: n };
}

export function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB): Poly[] {
  const h = [sx / 2, sy / 2, sz / 2];
  const center: Vec3 = [cx, cy, cz];
  const polys: Poly[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const [a, b] = [0, 1, 2].filter((i) => i !== axis);
      const quad: Vec3[] = [];
      for (const [da, db] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0];
        p[axis] = center[axis] + sign * h[axis];
        p[a] = center[a] + da * h[a];
        p[b] = center[b] + db * h[b];
        quad.push([p[0], p[1], p[2]]);
      }
      polys.push(orientedPoly(quad, color, center));
    }
  }
  return polys;
}

/** Upright pyramid/cone. `colors` is cycled per side. */
export function cone(cx: number, baseY: number, cz: number, radius: number, height: number, sides: number,
                     colors: readonly RGB[]): Poly[] {
  const apex: Vec3 = [cx, baseY + height, cz];
  const center: Vec3 = [cx, baseY + height * 0.3, cz];
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    ring.push([cx + radius * Math.cos((2 * Math.PI * i) / sides), baseY, cz + radius * Math.sin((2 * Math.PI * i) / sides)]);
  }
  return ring.map((_, i) => orientedPoly([ring[i], ring[(i + 1) % sides], apex], colors[i % colors.length], center));
}

/** Convex hexahedron from 8 vertices: 0-3 one quad, 4-7 the quad opposite it. */
export function prism(v: Vec3[], color: RGB): Poly[] {
  const center: Vec3 = [0, 1, 2].map((i) => v.reduce((s, p) => s + p[i], 0) / 8) as unknown as Vec3;
  const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2], [0, 4, 5, 1], [3, 2, 6, 7]];
  return faces.map((f) => orientedPoly(f.map((i) => v[i]), color, center));
}

/** Smooth body along z. stations: [z, halfWidth, halfHeight, centreY], nose first. */
export function loft(stations: readonly (readonly [number, number, number, number])[], sides: number,
                     colorFn: ColorFn, dx = 0): Poly[] {
  const rings: Vec3[][] = stations.map(([z, rx, ry, cy]) => {
    const ring: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      ring.push([dx + rx * Math.cos((2 * Math.PI * i) / sides), cy + ry * Math.sin((2 * Math.PI * i) / sides), z]);
    }
    return ring;
  });
  const polys: Poly[] = [];
  for (let k = 0; k < stations.length - 1; k++) {
    const axis: Vec3 = [dx, (stations[k][3] + stations[k + 1][3]) / 2, (stations[k][0] + stations[k + 1][0]) / 2];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      polys.push(orientedPoly([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], colorFn(k, i), axis));
    }
  }
  const first = stations[1], last = stations[stations.length - 2];
  for (const [ring, nxt] of [[rings[0], first], [rings[rings.length - 1], last]] as const) {
    polys.push(orientedPoly(ring, colorFn(0, 0), [dx, nxt[3], nxt[0]]));
  }
  return polys;
}

/** Wheel: a short cylinder whose axis is x. */
export function cylinderX(cx: number, cy: number, cz: number, radius: number, width: number, sides: number,
                          color: RGB): Poly[] {
  const polys: Poly[] = [];
  const ends: Vec3[][] = [];
  for (const sx of [-1, 1]) {
    const ring: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      ring.push([cx + (sx * width) / 2, cy + radius * Math.cos((2 * Math.PI * i) / sides),
        cz + radius * Math.sin((2 * Math.PI * i) / sides)]);
    }
    ends.push(ring);
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    polys.push(orientedPoly([ends[0][i], ends[0][j], ends[1][j], ends[1][i]], color, [cx, cy, cz]));
  }
  for (const ring of ends) polys.push(orientedPoly(ring, [30, 32, 36], [cx, cy, cz]));
  return polys;
}

export interface WingSpec {
  x0: number;
  span: number;
  le: Pair;
  te: Pair;
  y: Pair;
  thick: Pair;
}

/** A tapered, swept wing section between span fractions t0..t1; le/te/y/thick are [root, tip]. */
export function wingPanel(t0: number, t1: number, side: number, color: RGB, w: WingSpec): Poly[] {
  const at = (t: number, pair: Pair) => pair[0] + (pair[1] - pair[0]) * t;
  const v: Vec3[] = [];
  for (const sign of [1, -1]) {
    for (const [t, lead] of [[t0, true], [t0, false], [t1, false], [t1, true]] as const) {
      const z = at(t, lead ? w.le : w.te);
      v.push([side * (w.x0 + w.span * t), at(t, w.y) + (sign * at(t, w.thick)) / 2, z]);
    }
  }
  return prism(v, color);
}

export interface FinSpec {
  x?: number;
  y?: Pair;
  le?: Pair;
  te?: Pair;
  w?: Pair;
}

/** Swept vertical fin at lateral offset x; y/le/te/w are [root, tip]. */
export function finPanel(color: RGB, spec: FinSpec = {}): Poly[] {
  const { x = 0, y = [0.3, 1.95], le = [-2.9, -3.75], te = [-4.25, -4.3], w = [0.07, 0.035] } = spec;
  const v: Vec3[] = [];
  for (const sign of [1, -1]) {
    v.push([x + sign * w[0], y[0], le[0]], [x + sign * w[0], y[0], te[0]],
      [x + sign * w[1], y[1], te[1]], [x + sign * w[1], y[1], le[1]]);
  }
  return prism(v, color);
}

/** Two-blade propeller turned by `angle` about the z axis, in front of the spinner. */
export function propeller(angle: number, z = 4.95, length = 1.35): Poly[] {
  const polys: Poly[] = [];
  for (let k = 0; k < 2; k++) {
    const a = angle + k * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pt = (r: number, w: number, zz: number): Vec3 => [ca * r - sa * w, sa * r + ca * w, zz];
    const v = [pt(0.15, -0.11, z), pt(length, -0.07, z), pt(length, 0.07, z), pt(0.15, 0.11, z),
      pt(0.15, -0.11, z - 0.07), pt(length, -0.07, z - 0.07), pt(length, 0.07, z - 0.07), pt(0.15, 0.11, z - 0.07)];
    polys.push(...prism(v, [40, 42, 48]));
  }
  return polys;
}

/** An aircraft model: body polygons and the landing gear polygons, in plane-local coordinates
 *  (x = right, y = up, z = forward). */
export interface Model {
  body: Poly[];
  gear: Poly[];
}

const WHEEL: RGB = [22, 24, 28];

export function trainerMesh(): Model {
  const white: RGB = [238, 238, 242], red: RGB = [196, 44, 44], grey: RGB = [200, 204, 212];
  const glass: RGB = [46, 78, 112], dark: RGB = [44, 46, 52];
  const bodyColor: ColorFn = (k, i) => {
    if (k <= 1) return red; // engine cowling
    if ([9, 0, 4, 5].includes(i)) return red; // cheat line
    return [6, 7, 8].includes(i) ? grey : white;
  };
  const body: Poly[] = [];
  body.push(...loft([[4.3, 0.25, 0.25, 0.0], [4.0, 0.55, 0.55, 0.0], [3.2, 0.66, 0.66, 0.0],
    [1.5, 0.7, 0.8, 0.05], [-0.5, 0.65, 0.8, 0.1], [-2.5, 0.45, 0.5, 0.2], [-4.2, 0.12, 0.2, 0.3]], 10, bodyColor));
  body.push(...loft([[2.0, 0.05, 0.05, 0.8], [1.5, 0.52, 0.38, 0.9], [0.2, 0.6, 0.42, 0.92],
    [-1.0, 0.45, 0.34, 0.86], [-1.7, 0.05, 0.05, 0.8]], 8, () => glass));
  body.push(...loft([[4.5, 0.02, 0.02, 0.0], [4.3, 0.2, 0.2, 0.0], [4.9, 0.05, 0.05, 0.0]], 8, () => dark)); // spinner

  const wing: WingSpec = { x0: 0.4, span: 5.1, le: [0.9, 0.6], te: [-1.1, -0.6], y: [-0.35, -0.15], thick: [0.22, 0.1] };
  for (const side of [1, -1]) {
    body.push(...wingPanel(0.0, 0.8, side, white, wing));
    body.push(...wingPanel(0.8, 1.0, side, red, wing)); // wing tip
  }
  const stab: WingSpec = { x0: 0.1, span: 2.0, le: [-3.2, -3.75], te: [-4.3, -4.15], y: [0.22, 0.28], thick: [0.1, 0.06] };
  for (const side of [1, -1]) body.push(...wingPanel(0.0, 1.0, side, white, stab));
  body.push(...finPanel(red));

  const gear: Poly[] = [];
  for (const x of [-1.3, 1.3]) { // main gear
    gear.push(...box(x * 0.85, -0.55, 0.5, 0.08, 0.5, 0.1, dark));
    gear.push(...cylinderX(x, -0.7, 0.5, 0.3, 0.2, 8, WHEEL));
  }
  gear.push(...box(0, -0.5, 3.0, 0.08, 0.4, 0.1, dark)); // nose gear
  gear.push(...cylinderX(0, -0.7, 3.0, 0.28, 0.16, 8, WHEEL));
  return { body, gear };
}

const wheel = (x: number, y: number, z: number, r = 0.3, w = 0.2): Poly[] => cylinderX(x, y, z, r, w, 8, WHEEL);

export function biplaneMesh(): Model {
  const yellow: RGB = [236, 200, 60], blue: RGB = [40, 76, 150], dark: RGB = [44, 46, 52], fabric: RGB = [226, 190, 70];
  const bodyColor: ColorFn = (k, i) => {
    if (k <= 1) return blue;
    return [1, 2, 3, 4, 9, 0].includes(i) ? fabric : [200, 168, 60];
  };
  const body: Poly[] = [];
  body.push(...loft([[3.2, 0.3, 0.3, 0.0], [2.9, 0.62, 0.62, 0.0], [2.2, 0.68, 0.68, 0.0],
    [0.8, 0.6, 0.7, 0.05], [-1.0, 0.5, 0.6, 0.12], [-3.0, 0.3, 0.35, 0.2], [-4.4, 0.1, 0.15, 0.25]], 10, bodyColor));
  body.push(...box(0, 0.78, 0.7, 0.7, 0.12, 0.5, dark)); // windscreen / cockpit rim
  const low: WingSpec = { x0: 0.4, span: 4.6, le: [0.6, 0.6], te: [-0.9, -0.9], y: [-0.35, -0.2], thick: [0.14, 0.12] };
  const up: WingSpec = { x0: 0.0, span: 5.0, le: [0.8, 0.8], te: [-0.8, -0.8], y: [1.15, 1.15], thick: [0.14, 0.12] };
  for (const side of [1, -1]) {
    body.push(...wingPanel(0.0, 1.0, side, yellow, low));
    body.push(...wingPanel(0.0, 1.0, side, yellow, up));
    for (const x of [1.6, 4.4]) { // interplane struts
      body.push(...box(side * x, 0.45, 0.45, 0.07, 1.4, 0.07, dark));
      body.push(...box(side * x, 0.45, -0.6, 0.07, 1.4, 0.07, dark));
    }
  }
  body.push(...box(0, 0.8, 0.3, 0.1, 0.5, 0.1, dark), ...box(0.6, 0.9, 0.3, 0.1, 0.4, 0.1, dark));
  body.push(...box(0.3, 0.9, 0.9, 0.1, 0.3, 0.1, dark));
  const stab: WingSpec = { x0: 0.1, span: 1.9, le: [-3.5, -3.9], te: [-4.6, -4.5], y: [0.22, 0.25], thick: [0.1, 0.06] };
  for (const side of [1, -1]) body.push(...wingPanel(0.0, 1.0, side, yellow, stab));
  body.push(...finPanel(blue, { y: [0.3, 1.7], le: [-3.2, -4.0], te: [-4.55, -4.6] }));
  const gear: Poly[] = [];
  for (const x of [-1.1, 1.1]) {
    gear.push(...box(x * 0.8, -0.3, 0.9, 0.07, 0.8, 0.07, dark));
    gear.push(...wheel(x, -0.7, 0.9, 0.32, 0.16));
  }
  gear.push(...box(0, -0.15, -3.5, 0.06, 0.1, 0.3, dark)); // tail skid
  return { body, gear };
}

export function jetMesh(): Model {
  const grey: RGB = [122, 130, 142], light: RGB = [168, 176, 188], dark: RGB = [44, 46, 52], glass: RGB = [60, 96, 130];
  const bodyColor: ColorFn = (k, i) => {
    if (k >= 5) return dark; // exhaust
    return [6, 7, 8].includes(i) ? light : grey;
  };
  const body: Poly[] = [];
  body.push(...loft([[6.2, 0.05, 0.05, 0.0], [5.0, 0.35, 0.35, 0.0], [3.0, 0.7, 0.62, 0.05],
    [0.0, 0.8, 0.7, 0.05], [-3.0, 0.78, 0.66, 0.05], [-4.6, 0.62, 0.5, 0.05], [-5.2, 0.5, 0.42, 0.05]], 10, bodyColor));
  body.push(...loft([[3.4, 0.05, 0.05, 0.55], [2.7, 0.4, 0.35, 0.7], [1.4, 0.48, 0.42, 0.78],
    [0.0, 0.4, 0.3, 0.7], [-0.8, 0.05, 0.05, 0.6]], 8, () => glass));
  const wing: WingSpec = { x0: 0.5, span: 4.2, le: [0.5, -2.6], te: [-3.1, -3.5], y: [-0.2, -0.1], thick: [0.18, 0.07] };
  const stab: WingSpec = { x0: 0.6, span: 2.2, le: [-3.2, -4.8], te: [-5.0, -5.4], y: [0.0, 0.0], thick: [0.14, 0.06] };
  for (const side of [1, -1]) {
    body.push(...wingPanel(0.0, 1.0, side, grey, wing));
    body.push(...wingPanel(0.0, 1.0, side, light, stab));
    body.push(...finPanel(grey, { x: side * 0.95, y: [0.5, 2.0], le: [-3.4, -4.7], te: [-5.0, -5.3], w: [0.06, 0.03] }));
  }
  for (const x of [-0.6, 0.6]) body.push(...box(x * 1.4, 0.0, 2.4, 0.5, 0.55, 1.6, dark)); // intakes
  const gear: Poly[] = [];
  gear.push(...box(0, -0.65, 3.4, 0.08, 0.4, 0.1, dark));
  gear.push(...wheel(0, -0.95, 3.4, 0.25, 0.14));
  for (const x of [-1.2, 1.2]) {
    gear.push(...box(x, -0.7, -0.5, 0.08, 0.5, 0.1, dark));
    gear.push(...wheel(x, -0.95, -0.5, 0.25, 0.16));
  }
  return { body, gear };
}

export function airlinerMesh(): Model {
  const white: RGB = [240, 240, 244], blue: RGB = [40, 80, 170], grey: RGB = [206, 210, 218];
  const dark: RGB = [44, 46, 52], glass: RGB = [40, 60, 90];
  const bodyColor: ColorFn = (k, i) => {
    if ([1, 2, 3].includes(i)) return white;
    if ([9, 0, 4, 5].includes(i)) return k !== 0 ? blue : white; // window / cheat line
    return grey;
  };
  const gear: Poly[] = [];
  const body: Poly[] = [];
  body.push(...loft([[15.5, 0.3, 0.3, 0.3], [14.0, 1.2, 1.2, 0.3], [11.0, 1.9, 1.95, 0.3],
    [5.0, 2.05, 2.1, 0.3], [-6.0, 2.05, 2.1, 0.3], [-11.0, 1.6, 1.7, 0.7],
    [-15.0, 0.9, 1.1, 1.3], [-16.0, 0.3, 0.4, 1.5]], 10, bodyColor));
  body.push(...loft([[15.0, 0.9, 0.5, 1.0], [14.2, 1.15, 0.7, 1.05], [13.4, 1.2, 0.5, 1.1]], 6, () => glass)); // windscreen
  const wing: WingSpec = { x0: 1.6, span: 15.0, le: [3.0, -4.5], te: [-3.5, -7.5], y: [-1.1, 0.4], thick: [0.9, 0.25] };
  const stab: WingSpec = { x0: 0.8, span: 5.2, le: [-11.5, -15.0], te: [-15.0, -16.5], y: [1.1, 1.8], thick: [0.4, 0.15] };
  for (const side of [1, -1]) {
    body.push(...wingPanel(0.0, 1.0, side, white, wing));
    body.push(...wingPanel(0.0, 1.0, side, white, stab));
    const ex = side * 6.2; // under-wing engine
    body.push(...loft([[4.2, 0.0, 0.0, -2.2], [4.0, 1.0, 1.0, -2.2], [1.5, 1.15, 1.15, -2.2],
      [-2.0, 1.0, 1.0, -2.2], [-2.8, 0.6, 0.6, -2.2]], 10, (k) => (k === 0 ? dark : grey), ex));
    body.push(...box(ex, -1.5, -0.8, 0.3, 0.8, 1.6, grey)); // pylon
    gear.push(...box(side * 4.5, -2.0, 0.5, 0.2, 1.4, 0.2, dark));
    gear.push(...cylinderX(side * 4.5, -2.9, 0.5, 0.5, 0.5, 8, WHEEL));
  }
  body.push(...finPanel(blue, { y: [1.6, 6.8], le: [-9.0, -14.5], te: [-15.0, -16.2], w: [0.25, 0.1] }));
  gear.push(...box(0, -2.0, 11.0, 0.2, 1.2, 0.2, dark));
  gear.push(...cylinderX(0, -2.8, 11.0, 0.45, 0.4, 8, WHEEL));
  return { body, gear };
}

/**
 * Afterburner plume behind a nozzle at (0, y, z): glows from mid throttle, roars at full.
 * Returns unlit polygons (normal null); `t` drives the flicker.
 */
export function exhaustFlame(throttle: number, t: number, z: number, y: number, radius: number): Poly[] {
  const power = (throttle - 0.3) / 0.7;
  if (power <= 0) return [];
  const flick = 1 + 0.12 * Math.sin(t * 9) + 0.08 * Math.sin(t * 23 + 1);
  const length = radius * (3 + 9 * power ** 1.5) * flick;
  const polys: Poly[] = [];
  const layers: [number, number, RGB, RGB][] = [
    [1.0, 1.0, [255, 120, 30], [255, 180, 60]],
    [0.6, 0.62, [255, 200, 90], [255, 244, 200]],
  ];
  for (const [scale, lengthK, outer, inner] of layers) {
    const r = radius * scale, ln = length * lengthK;
    const stations: [number, number, number, number][] = [
      [z + 0.05, r * 0.85, r * 0.85, y], [z - ln * 0.3, r, r, y],
      [z - ln * 0.65, r * 0.55, r * 0.55, y], [z - ln, 0.03, 0.03, y]];
    for (const p of loft(stations, 8, (k) => (k < 2 ? outer : inner))) {
      polys.push({ verts: p.verts, color: p.color, normal: null });
    }
  }
  return polys;
}
