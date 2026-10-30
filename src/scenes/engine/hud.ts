/**
 * DOM glue for the shared HUD vocabulary (see ../ui/*.astro and ../ui/hud.css). Scenes mark their
 * markup with data-* hooks and talk to it through this class, so they never touch the DOM directly:
 *
 *   [data-tab=id] / [data-panel=id]   mode switcher and the panels it shows
 *   [data-action=name]                buttons; delivered through onAction()
 *   [data-readout=name]               live values in the readout strip
 *   [data-caption-*]                  the narrator card (see Caption.astro)
 *   [data-flash] [data-loading] [data-fallback]
 */

export type Tone = 'info' | 'ok' | 'warn' | 'fault';

/** One narrator beat: short `text`, optional `detail` tucked behind "Under the hood". Trusted HTML. */
export interface Message {
  kicker: string;
  title: string;
  text: string;
  detail?: string;
  tone?: Tone;
}

export class Hud {
  private caption: HTMLElement;
  private more: HTMLDetailsElement;
  private swapTimer = 0;

  constructor(readonly root: HTMLElement) {
    this.caption = this.q('[data-caption]');
    this.more = this.q<HTMLDetailsElement>('[data-caption-more]');
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`HUD is missing ${selector}`);
    return el;
  }

  /** Delegated clicks on any [data-action] button. */
  onAction(handler: (action: string, el: HTMLElement) => void) {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (el && !el.hasAttribute('disabled')) handler(el.dataset.action!, el);
    });
  }

  /** Wire the mode switcher. `initial` is shown immediately. */
  tabs(initial: string, onChange: (id: string) => void) {
    const buttons = [...this.root.querySelectorAll<HTMLElement>('[data-tab]')];
    const select = (id: string, notify: boolean) => {
      this.root.dataset.tab = id;
      buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
      this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => {
        p.hidden = p.dataset.panel !== id;
      });
      if (notify) onChange(id);
    };
    buttons.forEach((b) => b.addEventListener('click', () => b.dataset.tab !== this.root.dataset.tab && select(b.dataset.tab!, true)));
    select(initial, false);
  }

  say(msg: Message) {
    window.clearTimeout(this.swapTimer);
    this.caption.classList.add('is-swapping');
    this.swapTimer = window.setTimeout(() => {
      this.caption.dataset.tone = msg.tone ?? 'info';
      this.text('[data-caption-kicker]', msg.kicker);
      this.text('[data-caption-title]', msg.title);
      this.q('[data-caption-text]').innerHTML = msg.text;
      this.more.hidden = !msg.detail;
      if (msg.detail) this.q('[data-caption-detail]').innerHTML = msg.detail;
      this.caption.classList.remove('is-swapping');
    }, 140);
  }

  private text(selector: string, value: string) {
    this.q(selector).textContent = value;
  }

  /** Update a live value; numbers tick with a small bump so changes are noticed in peripheral vision. */
  readout(name: string, value: string | number) {
    const el = this.root.querySelector<HTMLElement>(`[data-readout="${name}"]`);
    if (!el) return;
    const next = String(value);
    if (el.textContent === next) return;
    el.textContent = next;
    el.dataset.zero = String(next === '0' || next === '—');
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  /** Full-screen colour flash, e.g. red when the program crashes. */
  flash(tone: 'fault' | 'ok' = 'fault') {
    const el = this.q('[data-flash]');
    el.dataset.tone = tone;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  setPlaying(playing: boolean) {
    this.root.querySelectorAll<HTMLElement>('[data-action="tour"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(playing));
      b.setAttribute('aria-label', playing ? 'Stop the guided story' : 'Play the guided story');
    });
  }

  /** Enable only the listed actions (e.g. the buttons that make sense on the current phone screen). */
  enableOnly(group: string, actions: string[]) {
    this.root.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] [data-action]`).forEach((b) => {
      b.disabled = !actions.includes(b.dataset.action!);
    });
  }

  ready() {
    this.root.dataset.state = 'ready';
  }

  fail() {
    this.root.dataset.state = 'failed';
  }
}
