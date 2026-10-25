/** On-screen display drawn on a 2D canvas above the 3D view: flight data, help and the cockpit frame. */
import * as cfg from './config';
import type { Plane } from './plane';
import type { RGB } from './vec';

const INK = '#ffffff';
const GOOD = 'rgb(120,230,140)';
const WARN = 'rgb(255,190,60)';
const BAD = 'rgb(255,90,80)';
const SHADOW = 'rgb(20,28,40)';

const HELP = [
  'W / S   nose down / up',
  'A / D   bank left / right',
  'Shift / Ctrl (or E / Q, Up / Down)   throttle up / down',
  'G   landing gear up / down',
  'B (hold)   air brake - slows you down',
  'C or 1-4   change aircraft',
  'N or F1-F5   change map',
  'Space or Esc   pause / resume',
  'P   change view      R   restart',
  'M   mute sound       H   hide help',
];

type Anchor = 'topleft' | 'topright' | 'midtop';

export interface Status {
  text: string;
  color: RGB;
}

/** The numbers and flags the HUD shows each frame. */
export interface HudState {
  plane: Plane;
  viewName: string;
  mapName: string;
  status: Status | null;
  paused: boolean;
  firstPerson: boolean;
  flash: number; // 0..1 white-out after an explosion
}

const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const int = (v: number): number => Math.trunc(v);
const signed = (v: number): string => {
  const n = int(v);
  return (n >= 0 ? '+' : '-') + Math.abs(n);
};
const pad = (v: number, width: number): string => String(v).padStart(width, ' ');

export class Hud {
  showHelp = true;
  private notice = '';
  private noticeUntil = 0;
  private w = 0;
  private h = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** Call whenever the canvas size (in CSS pixels) changes. */
  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
  }

  notify(text: string, seconds = 2.5): void {
    this.notice = text;
    this.noticeUntil = performance.now() + seconds * 1000;
  }

  private text(text: string, x: number, y: number, size: 'small' | 'font' | 'big', color: string = INK,
                anchor: Anchor = 'topleft'): void {
    const c = this.ctx;
    c.font = `bold ${size === 'big' ? 38 : size === 'font' ? 18 : 15}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    c.textBaseline = 'top';
    c.textAlign = anchor === 'topleft' ? 'left' : anchor === 'topright' ? 'right' : 'center';
    c.fillStyle = SHADOW;
    c.fillText(text, x + 2, y + 2);
    c.fillStyle = color;
    c.fillText(text, x, y);
  }

  /** A simple canopy frame and dashboard for the first-person view. */
  private cockpit(): void {
    const c = this.ctx, w = this.w, h = this.h;
    const poly = (pts: [number, number][], fill: string) => {
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };
    const frame = 'rgb(34,38,46)';
    poly([[0, h], [0, h - 120], [w * 0.3, h - 70], [w * 0.7, h - 70], [w, h - 120], [w, h]], frame);
    poly([[0, h], [0, h - 60], [w * 0.35, h - 40], [w * 0.65, h - 40], [w, h - 60], [w, h]], 'rgb(24,27,33)');
    poly([[0, 0], [70, 0], [0, h - 120]], frame);
    poly([[w, 0], [w - 70, 0], [w, h - 120]], frame);
    c.fillStyle = frame;
    c.fillRect(0, 0, w, 14);
    // gunsight
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, 18, 0, Math.PI * 2);
    c.moveTo(cx - 30, cy); c.lineTo(cx - 8, cy);
    c.moveTo(cx + 8, cy); c.lineTo(cx + 30, cy);
    c.stroke();
  }

  draw(s: HudState): void {
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    const plane = s.plane;
    if (s.flash > 0) {
      c.fillStyle = `rgba(255,240,200,${(220 / 255) * s.flash})`;
      c.fillRect(0, 0, w, h);
    }
    if (s.firstPerson && !(s.status && s.status.text.startsWith('CRASHED'))) this.cockpit();

    const kmh = plane.speed * 3.6;
    this.text(`SPD ${pad(int(kmh), 3)} km/h    ALT ${pad(int(plane.altitude), 4)} m    HDG ${String(int(plane.headingDegrees)).padStart(3, '0')}    VS ${signed(plane.verticalSpeed)} m/s`, 16, 12, 'font');
    this.text(`View: ${s.viewName}  (P to change)`, w - 16, 12, 'font', INK, 'topright');
    this.text(`${plane.spec.name}  (C to change)`, w - 16, 36, 'font', INK, 'topright');
    if (s.mapName) this.text(`Map: ${s.mapName}  (N to change)`, w - 16, 60, 'font', INK, 'topright');

    // throttle bar
    const bx = 16, by = h - 40, bw = 200, bh = 16;
    c.fillStyle = SHADOW;
    c.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    c.fillStyle = 'rgb(60,70,84)';
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = 'rgb(90,200,120)';
    c.fillRect(bx, by, Math.floor(bw * plane.throttle), bh);
    this.text('THROTTLE', bx + bw + 10, by, 'small');

    this.gearIndicator(plane);
    if (performance.now() < this.noticeUntil) this.text(this.notice, Math.floor(w / 2), h - 70, 'font', WARN, 'midtop');
    if (plane.onGround) {
      this.text(`ON GROUND  Shift = throttle, A/D steer, B brakes; pull back (S) above ${int(plane.spec.rotateSpeed * 3.6)} km/h`,
        Math.floor(w / 2), h - 100, 'font', WARN, 'midtop');
    }
    if (plane.gearDown && !plane.onGround) {
      this.landingPanel(plane);
    } else if (!plane.onGround && plane.altitude < 150 && plane.speed < plane.spec.landSpeed * 1.8) {
      this.text('LANDING GEAR UP - press G', 16, h - 168, 'font', WARN);
    }

    if (plane.wingLost) this.text(`${plane.wingLost.toUpperCase()} WING LOST!`, Math.floor(w / 2), 140, 'big', BAD, 'midtop');
    if (plane.stalled) this.text('STALL - nose down!', Math.floor(w / 2), 90, 'big', WARN, 'midtop');

    if (this.showHelp) HELP.forEach((line, i) => this.text(line, 16, 48 + i * 20, 'small'));

    if (s.status) {
      this.text(s.status.text, Math.floor(w / 2), Math.floor(h / 2) - 40, 'big', rgb(s.status.color), 'midtop');
      const again = s.status.text.startsWith('Landed') ? 'Press R to take off from here' : 'Press R to fly again';
      this.text(again, Math.floor(w / 2), Math.floor(h / 2) + 20, 'font', INK, 'midtop');
    }

    if (s.paused) {
      c.fillStyle = `rgba(10,16,28,${120 / 255})`;
      c.fillRect(0, 0, w, h);
      this.text('PAUSED', Math.floor(w / 2), Math.floor(h / 2) - 40, 'big', INK, 'midtop');
      this.text('Press Space to resume', Math.floor(w / 2), Math.floor(h / 2) + 20, 'font', INK, 'midtop');
    }
  }

  private gearIndicator(plane: Plane): void {
    let text = 'GEAR MOVING', color = WARN;
    if (plane.gearLockedDown) [text, color] = ['GEAR DOWN', GOOD];
    else if (plane.gear <= 0) [text, color] = ['GEAR UP', INK];
    this.text(text, this.w - 16, this.h - 36, 'small', color, 'topright');
  }

  /** What this aircraft needs to land, with live values coloured green when met. */
  private landingPanel(plane: Plane): void {
    const spec = plane.spec;
    const x = 16, y = this.h - 140;
    const fast = plane.speed >= spec.landSpeed;
    const sink = -plane.verticalSpeed;
    const rows: [string, string][] = [
      [`LANDING  speed under ${int(spec.landSpeed * 3.6)} km/h  (now ${int(plane.speed * 3.6)})`, fast ? WARN : GOOD],
      [`sink under ${cfg.LAND_MAX_SINK} m/s  (now ${int(Math.max(sink, 0))})`, sink >= cfg.LAND_MAX_SINK ? WARN : GOOD],
      ['wings and nose level - dry land only', INK],
    ];
    rows.forEach(([text, color], i) => this.text(text, x, y + i * 20, 'small', color));
    if (fast && plane.altitude < 250) this.text('TOO FAST - cut throttle, hold B', x, y - 28, 'font', WARN);
    if (plane.brake > 0.05) this.text('AIR BRAKE', x, y + 66, 'small', WARN);
  }
}
