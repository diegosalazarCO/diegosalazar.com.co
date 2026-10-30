class TourCancelled extends Error {}

export interface TourContext {
  /** Run an action, then hold for `after` ms so the narration can be read. */
  step(action: () => unknown, after?: number): Promise<void>;
  pause(ms: number): Promise<void>;
}

/**
 * A cancellable scripted walkthrough. Scripts read like a storyboard:
 *
 *   tour.start(async (t) => { await t.step(() => demo.allocate(), 2200); ... });
 *
 * stop() (or any manual interaction) aborts at the next await, even in the middle of a pause.
 */
export class Tour {
  private run = 0;
  private wakers = new Set<() => void>();
  playing = false;

  constructor(private onChange: (playing: boolean) => void = () => {}) {}

  start(script: (t: TourContext) => Promise<void>) {
    this.stop();
    const id = this.run;
    const alive = () => {
      if (id !== this.run) throw new TourCancelled();
    };
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          this.wakers.delete(done);
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(done, ms);
        this.wakers.add(done);
      }).then(alive);
    const ctx: TourContext = {
      pause,
      async step(action, after = 1500) {
        alive();
        await action();
        alive();
        await pause(after);
      },
    };

    this.playing = true;
    this.onChange(true);
    script(ctx)
      .catch((e) => {
        if (!(e instanceof TourCancelled)) throw e;
      })
      .finally(() => {
        if (id === this.run) {
          this.playing = false;
          this.onChange(false);
        }
      });
  }

  stop() {
    if (!this.playing) return;
    this.run++;
    this.playing = false;
    this.wakers.forEach((wake) => wake());
    this.onChange(false);
  }
}
