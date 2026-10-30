import { Vector3 } from 'three';
import type { Camera, Object3D } from 'three';

const scratch = new Vector3();

/**
 * An HTML label pinned to a 3D object. Text stays crisp, uses the site's fonts and can be styled in
 * CSS; the world projects every label to screen space once per frame.
 */
export class Label3D {
  readonly el = document.createElement('div');
  private shown = true;

  constructor(
    host: HTMLElement,
    private anchor: Object3D,
    title: string,
    sub = '',
    className = '',
    private lift = 0,
    /** Extra screen-space rise, for text that must clear another label whatever the zoom. */
    private liftPx = 0,
  ) {
    this.el.className = `node-label ${className}`.trim();
    this.set(title, sub);
    host.appendChild(this.el);
  }

  set(title: string, sub = '') {
    this.el.innerHTML = `<span class="t">${title}</span>${sub ? `<span class="s">${sub}</span>` : ''}`;
  }

  toggle(cls: string, on: boolean) {
    this.el.classList.toggle(cls, on);
  }

  update(camera: Camera, width: number, height: number) {
    this.anchor.getWorldPosition(scratch);
    scratch.y += this.lift;
    scratch.project(camera);
    const visible = this.inScene() && scratch.z < 1 && Math.abs(scratch.x) < 1.2 && Math.abs(scratch.y) < 1.2;
    if (visible !== this.shown) {
      this.shown = visible;
      this.el.style.visibility = visible ? 'visible' : 'hidden';
    }
    if (!visible) return;
    const x = (scratch.x * 0.5 + 0.5) * width;
    const y = (-scratch.y * 0.5 + 0.5) * height;
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, calc(-100% - ${this.liftPx}px))`;
  }

  /** Hidden stages (and anything inside them) must not leave their labels behind. */
  private inScene(): boolean {
    for (let o: Object3D | null = this.anchor; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  dispose() {
    this.el.remove();
  }
}
