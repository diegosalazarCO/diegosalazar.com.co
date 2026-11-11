/**
 * The plate list the page renders and the engine flies through: the generated manifest
 * (tools/plates/build_plates.py) joined with the hashed URLs of the files it wrote.
 */
import manifest from './plates.gen.json';

const files = import.meta.glob<string>('../assets/ink/*.webp', { eager: true, query: '?url', import: 'default' });
const url = (name: string): string => {
  const found = files[`../assets/ink/${name}`];
  if (!found) throw new Error(`src/assets/ink/${name} is missing: run tools/plates/build_plates.py`);
  return found;
};

export type Act = 'paper' | 'night';

export interface PlateData {
  id: string;
  title: string;
  note: string;
  act: Act;
  /** Pixel size of the colour image. */
  width: number;
  height: number;
  /** Relief depth in plate units (a plate is `plateHeight` units tall), as baked into its normals. */
  depth: number;
  colour: string;
  relief: string;
  /** u0, v0, u1, v1 of its thumbnail in the atlas (v runs down). */
  atlas: [number, number, number, number];
}

export interface InkData {
  atlas: string;
  plateHeight: number;
  plates: PlateData[];
}

export const ink: InkData = {
  atlas: url('atlas.webp'),
  plateHeight: manifest.plateHeight,
  plates: manifest.plates.map((plate) => ({
    id: plate.id,
    title: plate.title,
    note: plate.note,
    act: plate.act as Act,
    width: plate.width,
    height: plate.height,
    depth: plate.depth,
    colour: url(`${plate.id}.webp`),
    relief: url(`${plate.id}.relief.webp`),
    atlas: plate.atlas as [number, number, number, number],
  })),
};
