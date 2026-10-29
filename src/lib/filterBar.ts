export function moveIndicator(indicator: HTMLElement, target: HTMLElement) {
  indicator.style.width = `${target.offsetWidth}px`;
  indicator.style.height = `${target.offsetHeight}px`;
  indicator.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
}

/** Wraps a DOM mutation in a View Transition when supported, falling back to an instant apply. */
export function withViewTransition(apply: () => void) {
  if (document.startViewTransition) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}
