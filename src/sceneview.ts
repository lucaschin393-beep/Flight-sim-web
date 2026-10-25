/** The three.js side of the game: builds and updates the 3D scene from the game state. */
import * as THREE from 'three';
import { AIRCRAFT } from './aircraft';
import type { Aircraft } from './aircraft';
import type { GameCamera } from './camera';
import * as cfg from './config';
import type { Explosion, Piece } from './explosion';
import { particleLook } from './explosion';
import { polysToGeometry, setFrame, toThree } from './geometry';
import type { GameMap } from './maps';
import { TILE, CELL } from './maps';
import type { Poly } from './meshes';
import type { Plane } from './plane';
import type { RGB } from './vec';
import { CHUNK, LOAD_RADIUS } from './world';
import type { World } from './world';

// Keep colours exactly as authored (no sRGB conversion), like the original pygame renderer.
THREE.ColorManagement.enabled = false;

const SUN_FOR_SHADOW = [0.15, 1.0, 0.1] as const; // steeper than the light so the shadow stays close below you
const SHADOW_Y = 0.12;

const rgbColor = (c: RGB): THREE.Color => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);

/** Everything the scene needs to draw one frame. */
export interface Frame {
  world: World;
  plane: Plane;
  camera: GameCamera;
  /** Extra offset for the camera (explosion shake), in game coordinates. */
  shake: readonly [number, number, number];
  drawPlane: boolean;
  wrecked: boolean;
  explosion: Explosion | null;
  wingPieces: readonly Piece[];
  time: number;
}

/** The plane's meshes split into the parts that come and go (wings, gear) and the rest. */
interface PlaneGeometries {
  core: THREE.BufferGeometry;
  coreGear: THREE.BufferGeometry;
  wing: Record<'left' | 'right', THREE.BufferGeometry>;
  wingGear: Record<'left' | 'right', THREE.BufferGeometry>;
  prop: THREE.BufferGeometry | null;
}

const planeGeometryCache = new Map<Aircraft, PlaneGeometries>();

function planeGeometries(spec: Aircraft): PlaneGeometries {
  let g = planeGeometryCache.get(spec);
  if (g) return g;
  const gearSet = new Set(spec.gearMesh);
  const wingPolys = { left: spec.lostWingPolys.left, right: spec.lostWingPolys.right };
  const inWing = new Set<Poly>([...wingPolys.left, ...wingPolys.right]);
  const split = (side: 'left' | 'right', gear: boolean) => wingPolys[side].filter((p) => gearSet.has(p) === gear);
  g = {
    core: polysToGeometry(spec.mesh.filter((p) => !inWing.has(p))),
    coreGear: polysToGeometry(spec.gearMesh.filter((p) => !inWing.has(p))),
    wing: { left: polysToGeometry(split('left', false)), right: polysToGeometry(split('right', false)) },
    wingGear: { left: polysToGeometry(split('left', true)), right: polysToGeometry(split('right', true)) },
    prop: spec.propeller ? polysToGeometry(spec.propPolys(0)) : null,
  };
  planeGeometryCache.set(spec, g);
  return g;
}

/** One aircraft model as a group of meshes that follows the plane's state. */
class PlaneView {
  readonly group = new THREE.Group();
  private readonly gearParts: THREE.Mesh[] = [];
  private readonly wingL: THREE.Object3D[] = [];
  private readonly wingR: THREE.Object3D[] = [];
  private readonly prop: THREE.Mesh | null;
  private readonly flame: THREE.Mesh | null;

  constructor(readonly spec: Aircraft, material: THREE.Material, flameMaterial: THREE.Material | null,
              noCull = false) {
    const g = planeGeometries(spec);
    const mesh = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, material);
      m.frustumCulled = !noCull;
      this.group.add(m);
      return m;
    };
    mesh(g.core);
    this.gearParts.push(mesh(g.coreGear));
    this.wingL.push(mesh(g.wing.left));
    this.wingR.push(mesh(g.wing.right));
    const gl = mesh(g.wingGear.left), gr = mesh(g.wingGear.right);
    this.gearParts.push(gl, gr);
    this.wingL.push(gl);
    this.wingR.push(gr);
    this.prop = g.prop ? mesh(g.prop) : null;
    this.flame = spec.exhaust && flameMaterial ? new THREE.Mesh(new THREE.BufferGeometry(), flameMaterial) : null;
    if (this.flame) {
      this.flame.frustumCulled = false;
      this.group.add(this.flame);
    }
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
  }

  update(plane: Plane): void {
    const [fwd, right, up] = plane.basis;
    setFrame(this.group, plane.pos, right, up, fwd);
    const gearOut = plane.gear > 0.5;
    this.gearParts.forEach((m) => { m.visible = gearOut; });
    this.wingL.forEach((m) => { m.visible = m.visible && plane.wingLost !== 'left'; });
    this.wingR.forEach((m) => { m.visible = m.visible && plane.wingLost !== 'right'; });
    if (this.prop) this.prop.rotation.z = plane.propAngle;
    if (this.flame) {
      const polys = plane.spec.flamePolys(plane.throttle, plane.propAngle);
      this.flame.visible = polys.length > 0;
      if (polys.length) {
        this.flame.geometry.dispose();
        this.flame.geometry = polysToGeometry(polys, false);
      }
    }
  }
}

/** A soft round sprite texture for smoke, fire and spray. */
function circleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.8, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface ChunkView {
  terrain: THREE.Group;
  objects: THREE.Mesh | null;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 40000);
  private readonly sky: THREE.Mesh;
  private readonly farGround: THREE.Mesh;
  private readonly litMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly flatMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private readonly waterMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private readonly decalMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  private readonly flameMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x0a0e0a, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  private readonly planeViews = new Map<Aircraft, PlaneView>();
  private readonly shadowViews = new Map<Aircraft, PlaneView>();
  private readonly shadowRoot = new THREE.Group();
  private readonly chunks = new Map<string, ChunkView>();
  private readonly chunkRoot = new THREE.Group();
  private readonly runwayMesh: THREE.Mesh;
  private readonly decalMesh: THREE.Mesh;
  private readonly pieceMeshes = new Map<Piece, THREE.Mesh>();
  private readonly sprites: THREE.Sprite[] = [];
  private readonly spriteTexture: THREE.Texture;
  private world: World | null = null;
  private fog = new THREE.Fog(0xbed6e8, cfg.FOG_START, cfg.FOG_END);
  private ambient = new THREE.AmbientLight(0xffffff, 0.45 * Math.PI);
  private sun = new THREE.DirectionalLight(0xffffff, 0.55 * Math.PI);
  private vfovTan = Math.tan((cfg.FOV_DEGREES * Math.PI) / 360);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, stencil: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera.matrixAutoUpdate = false;
    this.scene.fog = this.fog;

    // Same shading as the original: 45% ambient + 55% from the sun (game light (0.4, 0.8, -0.3)).
    this.sun.position.set(0.4, 0.8, 0.3).multiplyScalar(100);
    this.scene.add(this.ambient, this.sun);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(20000, 32, 16),
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.farGround = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000),
      new THREE.MeshBasicMaterial({ color: 0x78b074 }));
    this.farGround.rotation.x = -Math.PI / 2;
    this.farGround.position.y = -3;
    this.scene.add(this.farGround);

    this.scene.add(this.chunkRoot);
    this.runwayMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.decalMaterial);
    this.scene.add(this.runwayMesh);
    this.decalMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.decalMaterial);
    this.decalMesh.frustumCulled = false;
    this.scene.add(this.decalMesh);

    this.shadowRoot.matrixAutoUpdate = false;
    this.shadowRoot.frustumCulled = false;
    this.scene.add(this.shadowRoot);
    this.spriteTexture = circleTexture();
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the horizontal field of view at cfg.FOV_DEGREES whatever the window shape.
    this.camera.fov = (2 * Math.atan(this.vfovTan / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** Switch to a world (a new map): rebuild sky, fog, ground colours and runway. */
  setWorld(world: World): void {
    this.world = world;
    const m = world.map;
    this.fog.color.copy(rgbColor(m.horizon));
    (this.farGround.material as THREE.MeshBasicMaterial).color.copy(rgbColor(m.far));
    this.paintSky(m);
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.runwayMesh.geometry.dispose();
    this.runwayMesh.geometry = polysToGeometry(world.runway, false);
  }

  private paintSky(m: GameMap): void {
    const geo = this.sky.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const top = rgbColor(m.skyTop), horizon = rgbColor(m.horizon), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const elevation = Math.asin(Math.max(-1, Math.min(1, pos.getY(i) / 20000))); // radians above the horizon
      const t = Math.max(0, Math.min(1, elevation / 0.75));
      c.copy(horizon).lerp(top, t);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // -- ground and objects, streamed in chunks around the camera ----------------
  private removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    chunk.terrain.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    if (chunk.objects) chunk.objects.geometry.dispose();
    this.chunkRoot.remove(chunk.terrain);
    if (chunk.objects) this.chunkRoot.remove(chunk.objects);
    this.chunks.delete(key);
  }

  private buildTerrain(world: World, cx: number, cz: number): THREE.Group {
    const land: Poly[] = [], water: Poly[] = [];
    const quad = (x0: number, z0: number, size: number, color: RGB, isWater: boolean): void => {
      (isWater ? water : land).push({
        verts: [[x0, 0, z0], [x0 + size, 0, z0], [x0 + size, 0, z0 + size], [x0, 0, z0 + size]], color, normal: null,
      });
    };
    const n = TILE / CELL, per = CHUNK / TILE;
    for (let tx = cx * per; tx < (cx + 1) * per; tx++) {
      for (let tz = cz * per; tz < (cz + 1) * per; tz++) {
        const cells = world.map.tile(tx, tz);
        if (cells.length === 1) {
          quad(tx * TILE, tz * TILE, TILE, cells[0][0], cells[0][1]);
        } else {
          cells.forEach(([color, isWater], k) => quad(tx * TILE + (k % n) * CELL, tz * TILE + Math.floor(k / n) * CELL, CELL, color, isWater));
        }
      }
    }
    const group = new THREE.Group();
    if (land.length) group.add(new THREE.Mesh(polysToGeometry(land, false), this.flatMaterial));
    if (water.length) group.add(new THREE.Mesh(polysToGeometry(water, false), this.waterMaterial));
    return group;
  }

  private syncChunks(world: World, x: number, z: number): void {
    const ccx = Math.floor(x / CHUNK), ccz = Math.floor(z / CHUNK);
    const wanted = new Set<string>();
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const cx = ccx + dx, cz = ccz + dz, key = `${cx},${cz}`;
        wanted.add(key);
        if (this.chunks.has(key)) continue;
        const terrain = this.buildTerrain(world, cx, cz);
        const polys = world.chunk(cx, cz).flatMap((o) => o.polys);
        const objects = polys.length ? new THREE.Mesh(polysToGeometry(polys), this.litMaterial) : null;
        this.chunkRoot.add(terrain);
        if (objects) this.chunkRoot.add(objects);
        this.chunks.set(key, { terrain, objects });
      }
    }
    for (const key of [...this.chunks.keys()]) if (!wanted.has(key)) this.removeChunk(key);
  }

  // -- aircraft ----------------------------------------------------------
  private viewFor(spec: Aircraft, shadow: boolean): PlaneView {
    const views = shadow ? this.shadowViews : this.planeViews;
    let v = views.get(spec);
    if (!v) {
      v = shadow
        ? new PlaneView(spec, this.shadowMaterial, null, true)
        : new PlaneView(spec, this.litMaterial, this.flameMaterial);
      views.set(spec, v);
      (shadow ? this.shadowRoot : this.scene).add(v.group);
    }
    return v;
  }

  private updatePlane(plane: Plane, show: boolean): void {
    for (const s of AIRCRAFT) {
      const real = this.planeViews.get(s), shade = this.shadowViews.get(s);
      if (real) real.group.visible = false;
      if (shade) shade.group.visible = false;
    }
    if (!show) return;
    const view = this.viewFor(plane.spec, false);
    view.group.visible = true;
    view.update(plane);
    // The shadow: the same model squashed onto the ground along the sun direction.
    if (plane.altitude < 700) {
      const sv = this.viewFor(plane.spec, true);
      sv.group.visible = true;
      sv.update(plane);
      const a = SUN_FOR_SHADOW[0] / SUN_FOR_SHADOW[1], c = SUN_FOR_SHADOW[2] / SUN_FOR_SHADOW[1], h = SHADOW_Y;
      this.shadowRoot.matrix.set(1, -a, 0, a * h, 0, 0, 0, h, 0, -c, 1, c * h, 0, 0, 0, 1);
      this.shadowRoot.matrixWorldNeedsUpdate = true;
      this.shadowMaterial.opacity = (120 - 80 * Math.min(plane.altitude / 500, 1)) / 255;
    }
  }

  // -- crash effects -----------------------------------------------------
  private updatePieces(pieces: readonly Piece[]): void {
    const live = new Set(pieces);
    for (const [piece, mesh] of this.pieceMeshes) {
      if (!live.has(piece)) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.scene.remove(mesh);
        this.pieceMeshes.delete(piece);
      }
    }
    for (const piece of pieces) {
      let mesh = this.pieceMeshes.get(piece);
      if (!mesh) {
        mesh = new THREE.Mesh(polysToGeometry(piece.rel), new THREE.MeshLambertMaterial({ vertexColors: true }));
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.pieceMeshes.set(piece, mesh);
      }
      mesh.visible = !piece.sunk;
      const [ax, ay, az] = piece.axes;
      setFrame(mesh, piece.center, ax, ay, az);
      (mesh.material as THREE.MeshLambertMaterial).color.setScalar(1 - piece.soot);
    }
  }

  private updateParticles(explosion: Explosion | null): void {
    const particles = explosion ? explosion.particles : [];
    while (this.sprites.length < particles.length) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.spriteTexture, transparent: true, depthWrite: false, fog: false }));
      sprite.frustumCulled = false;
      this.scene.add(sprite);
      this.sprites.push(sprite);
    }
    this.sprites.forEach((sprite, i) => {
      const p = particles[i];
      sprite.visible = p !== undefined;
      if (!p) return;
      const look = particleLook(p);
      toThree(p.pos, sprite.position);
      sprite.scale.setScalar(2 * look.radius);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.color.setRGB(look.color[0] / 255, look.color[1] / 255, look.color[2] / 255);
      mat.opacity = look.alpha;
    });
  }

  render(f: Frame): void {
    if (this.world !== f.world) this.setWorld(f.world);
    const cam = f.camera;
    const camPos: [number, number, number] = [cam.pos[0] + f.shake[0], cam.pos[1] + f.shake[1], cam.pos[2] + f.shake[2]];
    setFrame(this.camera, camPos, cam.right, cam.up, cam.fwd);
    this.camera.matrixWorldNeedsUpdate = true;

    toThree(camPos, this.sky.position);
    this.farGround.position.x = camPos[0];
    this.farGround.position.z = -camPos[2];
    this.syncChunks(f.world, camPos[0], camPos[2]);
    this.waterMaterial.color.setScalar(1 + 0.04 * Math.sin(f.time * 0.9));

    this.updatePlane(f.plane, f.drawPlane && !f.wrecked);
    const pieces = [...(f.explosion ? f.explosion.pieces : []), ...f.wingPieces];
    this.updatePieces(pieces);
    this.updateParticles(f.explosion);
    this.decalMesh.geometry.dispose();
    this.decalMesh.geometry = polysToGeometry(f.explosion ? f.explosion.groundDecals() : [], false);

    this.renderer.render(this.scene, this.camera);
  }
}

