/**
 * Game polygons -> three.js geometry.
 *
 * The game's world has x = right, y = up, z = forward, which is a mirror image of three.js's
 * (right-handed, camera looking down -z). Everything is converted at this boundary by flipping z
 * (and reversing triangle winding so faces still point outward).
 */
import * as THREE from 'three';
import type { Poly } from './meshes';
import type { Vec3 } from './vec';

/** Game position/direction -> three.js. */
export const toThree = (v: Vec3, out = new THREE.Vector3()): THREE.Vector3 => out.set(v[0], v[1], -v[2]);

/** Fan-triangulate polygons into one vertex-coloured geometry (normals only if every polygon has one). */
export function polysToGeometry(polys: readonly Poly[], lit = true): THREE.BufferGeometry {
  let tris = 0;
  for (const p of polys) tris += p.verts.length - 2;
  const pos = new Float32Array(tris * 9);
  const nor = lit ? new Float32Array(tris * 9) : null;
  const col = new Float32Array(tris * 9);
  let o = 0;
  for (const p of polys) {
    const n = p.normal ?? [0, 1, 0];
    const [r, g2, b] = [p.color[0] / 255, p.color[1] / 255, p.color[2] / 255];
    for (let k = 1; k < p.verts.length - 1; k++) {
      let tri = [p.verts[0], p.verts[k], p.verts[k + 1]];
      if (p.normal) {
        // Wind each triangle so it faces along the polygon's outward normal (z is mirrored, so
        // compare in three.js space), letting lit materials cull back faces.
        const a = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], -(tri[1][2] - tri[0][2])];
        const b = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], -(tri[2][2] - tri[0][2])];
        const g = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        if (g[0] * n[0] + g[1] * n[1] + g[2] * -n[2] < 0) tri = [tri[0], tri[2], tri[1]];
      } else {
        tri = [tri[0], tri[2], tri[1]]; // unlit polygons are drawn double-sided
      }
      for (const v of tri) {
        pos[o] = v[0]; pos[o + 1] = v[1]; pos[o + 2] = -v[2];
        if (nor) { nor[o] = n[0]; nor[o + 1] = n[1]; nor[o + 2] = -n[2]; }
        col[o] = r; col[o + 1] = g2; col[o + 2] = b;
        o += 3;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nor) geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Set an object's transform from a game-space frame: `pos` and the game-space images of the
 * object's local x, y, z axes (its geometry is in game-local coordinates converted by
 * polysToGeometry, so local z is mirrored again here).
 */
export function setFrame(obj: THREE.Object3D, pos: Vec3, ax: Vec3, ay: Vec3, az: Vec3): void {
  obj.matrixAutoUpdate = false;
  obj.matrix.makeBasis(new THREE.Vector3(ax[0], ax[1], -ax[2]), new THREE.Vector3(ay[0], ay[1], -ay[2]),
    new THREE.Vector3(-az[0], -az[1], az[2]));
  obj.matrix.setPosition(pos[0], pos[1], -pos[2]);
  obj.matrixWorldNeedsUpdate = true;
}
