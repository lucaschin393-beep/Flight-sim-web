/** Browser entry point: canvases, keyboard, sound unlock and the animation loop. */
import * as cfg from './config';
import { Game } from './game';
import type { Controls } from './game';
import { Hud } from './hud';
import { MAPS } from './maps';
import { SceneView } from './sceneview';
import { Sounds } from './sound';

const viewCanvas = document.getElementById('view') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const startScreen = document.getElementById('start') as HTMLDivElement;

const scene = new SceneView(viewCanvas);
const hudCtx = hudCanvas.getContext('2d')!;
const hud = new Hud(hudCtx);
const sounds = new Sounds();
const game = new Game(sounds, (text) => hud.notify(text));

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  scene.resize(w, h);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  hudCanvas.width = Math.floor(w * dpr);
  hudCanvas.height = Math.floor(h * dpr);
  hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hud.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// -- keyboard -------------------------------------------------------------
const down = new Set<string>();
let started = false;

function start(): void {
  sounds.unlock(); // browsers only allow audio after a user gesture
  if (!started) {
    started = true;
    startScreen.style.display = 'none';
  }
}
startScreen.addEventListener('pointerdown', start);
window.addEventListener('pointerdown', () => sounds.unlock());

const BLOCKED = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4', 'F5']);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.altKey) return; // leave browser shortcuts alone
  if (BLOCKED.has(e.code)) e.preventDefault();
  if (!started) {
    if (e.code !== 'Escape') start();
    return;
  }
  sounds.unlock();
  down.add(e.code);
  if (e.repeat) return;
  const fkey = /^F([1-5])$/.exec(e.code);
  if (fkey) game.switchMap(Number(fkey[1]) - 1);
  else if (e.code === 'Space' || e.code === 'Escape') game.togglePause();
  else if (e.code === 'KeyP') game.cycleView();
  else if (e.code === 'KeyH') hud.showHelp = !hud.showHelp;
  else if (e.code === 'KeyR') game.restart();
  else if (e.code === 'KeyN') game.switchMap(game.mapIndex + 1);
  else if (e.code === 'KeyM') hud.notify(sounds.toggleMute() ? 'Sound off' : 'Sound on');
  else if (e.code === 'KeyG') game.toggleGear();
  else if (e.code === 'KeyC') game.selectAircraft('next');
  else if (/^Digit[1-4]$/.test(e.code)) game.selectAircraft(Number(e.code.slice(5)) - 1);
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => down.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && !game.paused) game.togglePause();
});

const held = (...codes: string[]): number => (codes.some((c) => down.has(c)) ? 1 : 0);

function controls(): Controls {
  const pitchSign = cfg.INVERT_PITCH ? -1 : 1;
  return {
    pitch: (held('KeyS') - held('KeyW')) * pitchSign,
    roll: held('KeyD') - held('KeyA'),
    throttle: held('ShiftLeft', 'ShiftRight', 'KeyE', 'ArrowUp') - held('ControlLeft', 'ControlRight', 'KeyQ', 'ArrowDown'),
    brake: down.has('KeyB'),
  };
}

// -- loop -----------------------------------------------------------------
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (started) game.update(dt, controls());

  scene.render({
    world: game.world,
    plane: game.plane,
    camera: game.camera,
    shake: game.shake(),
    drawPlane: !game.firstPerson,
    wrecked: game.explosion !== null,
    explosion: game.explosion,
    wingPieces: game.wingPieces,
    time: now / 1000,
  });
  hud.draw({
    plane: game.plane,
    viewName: game.view,
    mapName: game.world.map.name,
    status: game.status,
    paused: game.paused && started,
    firstPerson: game.firstPerson,
    flash: game.explosion ? game.explosion.flash : 0,
  });
  requestAnimationFrame(frame);
}
game.camera.follow(game.plane, game.view, 0);
requestAnimationFrame(frame);

// Handy for poking around in the browser console.
(window as unknown as Record<string, unknown>).game = game;
(window as unknown as Record<string, unknown>).maps = MAPS;
(window as unknown as Record<string, unknown>).view3d = scene;
