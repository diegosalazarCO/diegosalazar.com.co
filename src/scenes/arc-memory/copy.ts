/**
 * Everything the narrator says. Kept out of the logic so the story can be edited like prose:
 * short `text` (what just happened) and an optional `detail` (what the runtime really did),
 * which the HUD tucks behind an "Under the hood" disclosure.
 *
 * Strings are trusted, author-written HTML (only <code>, <strong>, <pre>).
 */

import type { Message } from '../engine/hud';

const HW = '01 · Hardware';
const ARCH = '02 · Architecture';

export const hardware = {
  idle: (): Message => ({
    kicker: HW,
    title: 'Memory is a grid of addressed cells',
    text: 'This is a DDR module. Every cell has an address. Press <strong>Allocate</strong> and watch Swift claim one, or hit ▶ to watch the whole story.',
    detail:
      'DRAM cells slowly leak charge, so the memory controller sweeps across the chips constantly to refresh them. That is the faint light crossing the module.',
  }),

  allocate: (addr: string): Message => ({
    kicker: HW,
    title: 'Allocate · RC = 1',
    text: `<code>swift_allocObject</code> claims the cell at <code>${addr}</code>. The address lands in register <code>x0</code>, and the retain count starts at 1.`,
    detail:
      'The runtime asks the allocator for a block, writes the object header (type metadata and an inline refcount) and returns the address. The stack frame keeping that address <em>is</em> the first strong reference.',
  }),

  alreadyAllocated: (addr: string): Message => ({
    kicker: HW,
    title: 'Already allocated',
    text: `<code>${addr}</code> is live. Add references to it, or release them until it dies.`,
    tone: 'warn',
  }),

  needObject: (): Message => ({
    kicker: HW,
    title: 'Nothing to point at',
    text: 'Allocate an object first: references need a target.',
    tone: 'warn',
  }),

  strong: (rc: number): Message => ({
    kicker: HW,
    title: `Strong reference · RC = ${rc}`,
    text: `Another owner copies the pointer. <code>swift_retain</code> bumps the count to <strong>${rc}</strong>; the object now survives until every owner lets go.`,
    detail:
      'Retain is an atomic update of the refcount in the object header, so it is safe across threads. It is cheap but not free, which is why retain/release traffic shows up in profiles of hot loops.',
  }),

  weak: (rc: number, first: boolean): Message => ({
    kicker: HW,
    title: 'Weak reference · count unchanged',
    text: `RC stays <strong>${rc}</strong>. A weak reference doesn't point at the object itself but at its <strong>side table</strong>, so the object can die and the reference simply reads <code>nil</code>.`,
    detail: first
      ? 'The first weak reference makes Swift allocate a side table that can outlive the object’s memory. Weak loads consult it: if the object is already deinitialized you get <code>nil</code>, never a dangling pointer.'
      : 'Further weak references share the same side table, which records whether the object is still alive.',
  }),

  unowned: (addr: string): Message => ({
    kicker: HW,
    title: 'Unowned reference · not counted',
    text: `A non-owning pointer straight to <code>${addr}</code>. No side table, no <code>nil</code>: you promise the object outlives it.`,
    detail:
      'Safe <code>unowned</code> tracks an unowned count and traps with a clear runtime error if you read it after deinit. <code>unowned(unsafe)</code> is a raw pointer: reading after free is undefined behaviour.',
  }),

  release: (rc: number): Message => ({
    kicker: HW,
    title: `Release · RC = ${rc}`,
    text: `<code>swift_release</code> drops the count to <strong>${rc}</strong>. Someone still owns the object, so its cell stays occupied.`,
  }),

  nothingToRelease: (): Message => ({
    kicker: HW,
    title: 'No strong references left',
    text: 'There is no owner to release.',
    tone: 'warn',
  }),

  freed: (addr: string, weak: number, unowned: number): Message => ({
    kicker: HW,
    title: 'Deallocated · RC = 0',
    text:
      `The last owner let go: <code>deinit</code> runs and <code>${addr}</code> returns to the allocator.` +
      (weak ? ' Weak references now read <code>nil</code>.' : '') +
      (unowned ? ` <strong>${unowned} unowned pointer${unowned > 1 ? 's' : ''} now dangle.</strong> Hit <strong>Read</strong> to find out what happens.` : ''),
    detail:
      'Nothing is "cleaned" in the silicon: the allocator just marks the block free and the next allocation may reuse it. That is why a stale pointer can read plausible garbage if nothing traps it.',
    tone: unowned ? 'warn' : 'ok',
  }),

  noRefs: (): Message => ({
    kicker: HW,
    title: 'No references to read',
    text: 'The CPU has no pointers to follow. Add a strong, weak or unowned reference first.',
    tone: 'warn',
  }),

  read: (outcome: { strong: boolean; weak: 'ok' | 'nil' | null; unowned: 'ok' | 'trap' | null }): Message => {
    const lines: string[] = [];
    if (outcome.strong) lines.push('strong → <strong>ok</strong>');
    if (outcome.weak) lines.push(`weak → <strong>${outcome.weak === 'nil' ? 'nil' : 'ok'}</strong>`);
    if (outcome.unowned) lines.push(`unowned → <strong>${outcome.unowned === 'trap' ? 'trap' : 'ok'}</strong>`);
    return {
      kicker: HW,
      title: 'The CPU follows each pointer',
      text: lines.join(' · '),
      tone: 'ok',
    };
  },

  trap: (addr: string): Message => ({
    kicker: HW,
    title: 'Fatal error',
    text: `Attempted to read an unowned reference but object <code>${addr}</code> was already deallocated.`,
    detail:
      'Swift traps deterministically instead of returning garbage. With <code>unowned(unsafe)</code> or a raw pointer you would get undefined behaviour instead, typically <code>EXC_BAD_ACCESS</code> or silent corruption.',
    tone: 'fault',
  }),

  reset: (): Message => ({
    kicker: HW,
    title: 'Memory cleared',
    text: 'Cells and registers are back to idle. Try another allocation.',
  }),
};

export const architecture = {
  init: (): Message => ({
    kicker: ARCH,
    title: 'Who owns whom?',
    text: '<strong>AppRoot</strong> owns each screen. Log in to build a Dashboard: ViewController → ViewModel → Interactor, then log out and see what survives.',
  }),

  dashLeak: (n: number): Message => ({
    kicker: ARCH,
    title: `Dashboard #${n} · cycle armed`,
    text: 'The Interactor holds the ViewModel strongly <em>and</em> the ViewModel holds the Interactor. Each one keeps the other’s count above zero.',
    detail:
      '<pre><code>final class DashboardInteractor {\n  var output: DashboardOutput?   // strong back-reference\n}</code></pre>',
  }),

  dashSafe: (n: number): Message => ({
    kicker: ARCH,
    title: `Dashboard #${n} · cycle broken`,
    text: 'The Interactor’s back-reference is <strong>weak</strong>, so it adds nothing to the ViewModel’s count. Ownership flows one way only.',
    detail:
      '<pre><code>final class DashboardInteractor {\n  weak var output: DashboardOutput?\n}</code></pre>',
  }),

  featOpen: (): Message => ({
    kicker: ARCH,
    title: 'Feature scene pushed',
    text: 'DashboardVC retains the FeatureVC. Going back will release it, and ARC frees it on the spot.',
  }),

  featClosed: (): Message => ({
    kicker: ARCH,
    title: 'Feature scene popped',
    text: 'The Dashboard let go, the count hit 0 and the FeatureVC was deallocated immediately. No garbage collector pause.',
    tone: 'ok',
  }),

  logoutClean: (): Message => ({
    kicker: ARCH,
    title: 'Logout · zero leaks',
    text: 'AppRoot dropped the Dashboard and the release cascaded: ViewController → ViewModel → Interactor. Every count reached 0.',
    tone: 'ok',
  }),

  logoutLeaked: (): Message => ({
    kicker: ARCH,
    title: 'Logout · retain cycle',
    text: 'AppRoot released the ViewController, but <strong>ViewModel and Interactor still own each other</strong>. Nothing points at them from outside, yet neither can reach 0.',
    detail:
      'This is a leak, not a crash: the pair stays on the heap for the life of the process, and every new login adds another. Xcode’s Memory Graph shows it as an island with a purple <code>!</code>.',
    tone: 'fault',
  }),

  fixOn: (): Message => ({
    kicker: ARCH,
    title: 'Back-reference is now weak',
    text: 'The next login builds the Dashboard with a weak Interactor → ViewModel link. Try it.',
    tone: 'ok',
  }),

  fixOff: (): Message => ({
    kicker: ARCH,
    title: 'Back-reference is strong again',
    text: 'The next login builds the Dashboard with the retain cycle armed.',
    tone: 'warn',
  }),

  reset: (): Message => ({
    kicker: ARCH,
    title: 'Heap cleared',
    text: 'All sessions removed. Log in again to start over.',
  }),
};
