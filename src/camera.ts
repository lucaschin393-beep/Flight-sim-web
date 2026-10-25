/** Camera with first-person and chase (third-person) modes, in game coordinates. */
import type { Plane } from './plane';
import { add, cross, lerp, normalize, scale, sub } from './vec';
import type { Vec3 } from './vec';

export const FIRST_PERSON = '1st person';
export const THIRD_PERSON = '3rd person';
export const VIEWS = [THIRD_PERSON, FIRST_PERSON] as const;
export type View = (typeof VIEWS)[number];

export class GameCamera {
  pos: Vec3 = [0, 0, 0];
  fwd: Vec3 = [0, 0, 1];
  right: Vec3 = [1, 0, 0];
  up: Vec3 = [0, 1, 0];
  private snap = true;

  setBasis(pos: Vec3, fwd: Vec3, up: Vec3): void {
    this.pos = pos;
    this.fwd = normalize(fwd);
    this.right = normalize(cross(up, this.fwd));
    this.up = cross(this.fwd, this.right);
  }

  /** Jump straight to the target on the next chase update (after a view change). */
  snapNextUpdate(): void {
    this.snap = true;
  }

  /** `back` pulls the chase camera further away (1 = normal), e.g. to watch a crash from a distance. */
  follow(plane: Plane, view: View, dt: number, back = 1): void {
    const [fwd, , up] = plane.basis;
    if (view === FIRST_PERSON) {
      const [eyeUp, eyeFwd] = plane.spec.eye;
      this.setBasis(add(add(plane.pos, scale(up, eyeUp)), scale(fwd, eyeFwd)), fwd, up);
      return;
    }
    // Chase camera: behind and above, easing toward the target.
    const softUp = normalize(lerp([0, 1, 0], up, 0.35));
    const target = add(add(plane.pos, scale(fwd, -plane.spec.chaseDistance * back)), scale(softUp, plane.spec.chaseHeight * back));
    let pos = this.snap ? target : lerp(this.pos, target, Math.min(1, 6 * dt));
    this.snap = false;
    pos = [pos[0], Math.max(pos[1], 2), pos[2]];
    const lookAt = add(plane.pos, scale(fwd, plane.spec.chaseDistance / 2));
    this.setBasis(pos, sub(lookAt, pos), softUp);
  }
}
