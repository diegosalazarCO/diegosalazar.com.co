/**
 * The page side of the flight: turns the document's scroll position into a rail position, and
 * moves the few HTML pieces that follow it (captions, the index rail, the text colour).
 * It only writes to the DOM when a value actually changed.
 */
import { smoothstep } from './rail';

const PAPER_TEXT = [14, 12, 10];
const NIGHT_TEXT = [239, 230, 210];

export class Hud {
  private readonly list: HTMLElement;
  private readonly captions: HTMLElement[];
  private readonly ticks: HTMLElement[];
  private readonly stats: HTMLElement | null;
  private listTop = 0;
  private step = 1;
  private viewport = 1;
  private shown = new Map<number, number>();
  private current = -1;
  private tone = -1;
  private underWay = false;

  constructor(private readonly root: HTMLElement) {
    this.list = root.querySelector<HTMLElement>('[data-ink-plates]')!;
    this.captions = [...this.list.querySelectorAll<HTMLElement>('figcaption')];
    this.ticks = [...root.querySelectorAll<HTMLElement>('[data-ink-tick]')];
    this.stats = root.querySelector<HTMLElement>('[data-ink-stats]');
    this.ticks.forEach((tick, index) =>
      tick.addEventListener('click', (event) => {
        event.preventDefault();
        window.scrollTo({ top: this.scrollFor(index), behavior: 'smooth' });
      }),
    );
    this.measure();
  }

  /** Read the layout once per resize, never per frame. */
  measure(): void {
    this.viewport = window.innerHeight;
    this.listTop = this.list.getBoundingClientRect().top + window.scrollY;
    this.step = this.list.offsetHeight / Math.max(1, this.captions.length);
  }

  /** Rail position for the current scroll: plate i is framed when its section is centred. */
  position(): number {
    return (window.scrollY + this.viewport / 2 - this.listTop - this.step / 2) / this.step;
  }

  scrollFor(index: number): number {
    return this.listTop + this.step * (index + 0.5) - this.viewport / 2;
  }

  update(u: number, night: number): void {
    // Captions: only the plate being framed (and its neighbours, mid-fade) is ever touched.
    const nearest = Math.round(u);
    const live = new Set<number>();
    for (let i = nearest - 1; i <= nearest + 1; i++) {
      const caption = this.captions[i];
      if (!caption) continue;
      const du = u - i;
      const opacity = smoothstep(-0.36, -0.14, du) * (1 - smoothstep(0.1, 0.3, du));
      if (opacity <= 0) continue;
      live.add(i);
      if (Math.abs((this.shown.get(i) ?? -1) - opacity) > 0.004) {
        caption.style.opacity = opacity.toFixed(3);
        caption.style.transform = `translate3d(0, ${(-du * 46).toFixed(1)}px, 0)`;
        caption.style.visibility = 'visible';
        this.shown.set(i, opacity);
      }
    }
    for (const i of this.shown.keys()) {
      if (live.has(i)) continue;
      this.captions[i].style.opacity = '0';
      this.captions[i].style.visibility = 'hidden';
      this.shown.delete(i);
    }

    const index = Math.min(this.ticks.length - 1, Math.max(0, nearest));
    if (index !== this.current) {
      this.ticks[this.current]?.removeAttribute('aria-current');
      this.ticks[index]?.setAttribute('aria-current', 'true');
      this.current = index;
    }

    // Text follows the world's tone, so it stays readable while the lights go out.
    const tone = Math.round(night * 50) / 50;
    if (tone !== this.tone) {
      const rgb = PAPER_TEXT.map((c, k) => Math.round(c + (NIGHT_TEXT[k] - c) * tone));
      this.root.style.setProperty('--ink-fg', `rgb(${rgb.join(' ')})`);
      this.root.classList.toggle('is-night', tone > 0.5);
      this.tone = tone;
    }
    if (u > -0.62 !== this.underWay) {
      this.underWay = !this.underWay;
      this.root.classList.toggle('is-under-way', this.underWay);
    }
  }

  readout(text: string): void {
    if (this.stats && this.stats.textContent !== text) this.stats.textContent = text;
  }
}
