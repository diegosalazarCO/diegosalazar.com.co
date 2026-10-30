import { Color } from 'three';

/**
 * Scene colours come from CSS custom properties, so the stylesheet is the single source of truth for
 * both the HUD and the WebGL scene. A scene declares `--scene-<key>` tokens on its root element
 * (derived from the site tokens) and asks for the keys it uses, e.g. ARC reads strong / weak /
 * unowned / fault, a Core ML scene would read ane / gpu / cpu.
 */
export interface Palette<K extends string> {
  bg: Color;
  ink: Color;
  color: Record<K, Color>;
  /** The same colours as CSS strings, for HTML labels. */
  css: Record<K, string>;
}

export function readPalette<K extends string>(el: Element, keys: readonly K[]): Palette<K> {
  const styles = getComputedStyle(el);
  const read = (name: string) => {
    const value = styles.getPropertyValue(name).trim();
    if (!value) throw new Error(`Missing CSS token ${name} on the scene root`);
    return value;
  };
  const css = {} as Record<K, string>;
  const color = {} as Record<K, Color>;
  for (const key of keys) {
    css[key] = read(`--scene-${key}`);
    color[key] = new Color(css[key]);
  }
  return { bg: new Color(read('--color-bg')), ink: new Color(read('--color-text')), color, css };
}
