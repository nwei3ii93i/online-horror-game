import { Noise } from './noise';
import { TexBuilder, PackedTexture } from './TexBuilder';
import * as masonry from './gen/masonry';
import * as wood from './gen/wood';
import * as ground from './gen/ground';
import * as nature from './gen/nature';
import * as misc from './gen/misc';

export interface TextureDef {
  id: string;
  /** Generator paints into the builder. */
  gen: (b: TexBuilder) => void;
  /** Relative resolution (1 = quality profile size). */
  res?: number;
  seed?: number;
}

/** Bump when generators change so cached textures are regenerated. */
export const TEXGEN_VERSION = 4;

export const TEXTURE_DEFS: TextureDef[] = [
  { id: 'brick', gen: masonry.brick, seed: 11 },
  { id: 'plaster_ext', gen: (b) => masonry.plasterExterior(b), seed: 12 },
  { id: 'plaster_ext_grey', gen: (b) => masonry.plasterExterior(b, '#9c9a92'), seed: 13 },
  { id: 'plaster_int', gen: (b) => masonry.plasterInterior(b), seed: 14 },
  { id: 'stone_wall', gen: masonry.stoneWall, seed: 15 },
  { id: 'stone_slab', gen: masonry.stoneSlab, seed: 21 },
  { id: 'concrete', gen: (b) => masonry.concrete(b), seed: 16 },
  { id: 'roof_tiles', gen: masonry.roofTiles, seed: 17 },
  { id: 'floor_tiles', gen: (b) => masonry.floorTiles(b), seed: 18, res: 0.5 },
  { id: 'wall_tiles', gen: (b) => masonry.wallTiles(b), seed: 19, res: 0.5 },
  { id: 'ceiling', gen: (b) => masonry.plasterInterior(b, '#cfcabe'), seed: 20, res: 0.5 },
  // wood
  { id: 'floor_boards', gen: (b) => wood.floorBoards(b), seed: 30 },
  { id: 'floor_boards_dark', gen: (b) => wood.floorBoards(b, '#6a4c34', '#35251a', 10), seed: 31 },
  { id: 'parquet', gen: wood.parquet, seed: 32 },
  { id: 'barn_boards', gen: wood.barnBoards, seed: 33 },
  { id: 'painted_wood_white', gen: (b) => wood.paintedWood(b, '#cfc9b8'), seed: 34, res: 0.5 },
  { id: 'painted_wood_green', gen: (b) => wood.paintedWood(b, '#3f5442', 6), seed: 35, res: 0.5 },
  { id: 'painted_wood_brown', gen: (b) => wood.paintedWood(b, '#5a3e2a', 1), seed: 36, res: 0.5 },
  { id: 'furniture_wood', gen: (b) => wood.furnitureWood(b), seed: 37, res: 0.5 },
  { id: 'furniture_oak', gen: (b) => wood.furnitureWood(b, '#8a6a42', '#4a3420'), seed: 38, res: 0.5 },
  { id: 'rough_timber', gen: (b) => wood.roughTimber(b), seed: 39, res: 0.5 },
  { id: 'wainscot', gen: wood.wainscot, seed: 40, res: 0.5 },
  // ground
  { id: 'forest_floor', gen: ground.forestFloor, seed: 50 },
  { id: 'meadow', gen: ground.meadow, seed: 51 },
  { id: 'mud', gen: ground.mud, seed: 52 },
  { id: 'gravel', gen: ground.gravel, seed: 53 },
  { id: 'asphalt', gen: ground.asphalt, seed: 54 },
  { id: 'moss', gen: ground.moss, seed: 55, res: 0.5 },
  { id: 'rock', gen: ground.rock, seed: 56 },
  // nature
  { id: 'bark_spruce', gen: nature.barkSpruce, seed: 60, res: 0.5 },
  { id: 'bark_beech', gen: nature.barkBeech, seed: 61, res: 0.5 },
  { id: 'bark_birch', gen: nature.barkBirch, seed: 62, res: 0.5 },
  { id: 'bark_oak', gen: nature.barkOak, seed: 63, res: 0.5 },
  { id: 'deadwood', gen: nature.deadwood, seed: 64, res: 0.5 },
  // misc
  { id: 'rust_metal', gen: misc.rustMetal, seed: 70, res: 0.5 },
  { id: 'painted_metal', gen: (b) => misc.paintedMetal(b), seed: 71, res: 0.5 },
  { id: 'painted_metal_cream', gen: (b) => misc.paintedMetal(b, '#c8bfa8'), seed: 72, res: 0.5 },
  { id: 'corrugated', gen: misc.corrugated, seed: 73, res: 0.5 },
  { id: 'fabric_brown', gen: (b) => misc.fabric(b, '#5a4636'), seed: 74, res: 0.25 },
  { id: 'fabric_green', gen: (b) => misc.fabric(b, '#47503c', 'floral', '#8a7a52'), seed: 75, res: 0.25 },
  { id: 'fabric_red', gen: (b) => misc.fabric(b, '#6a2e28', 'plain'), seed: 76, res: 0.25 },
  { id: 'fabric_check', gen: (b) => misc.fabric(b, '#7a7468', 'check', '#3a4a5a'), seed: 77, res: 0.25 },
  { id: 'fabric_white', gen: (b) => misc.fabric(b, '#bdb6a6'), seed: 78, res: 0.25 },
  { id: 'glass_dirt', gen: misc.glassDirt, seed: 79, res: 0.5 },
  { id: 'linoleum', gen: (b) => misc.linoleum(b), seed: 80, res: 0.5 },
  { id: 'cardboard', gen: misc.cardboard, seed: 81, res: 0.25 },
  { id: 'hay', gen: misc.hay, seed: 82, res: 0.5 },
  { id: 'wallpaper_stripe', gen: (b) => misc.wallpaper(b, 0), seed: 83 },
  { id: 'wallpaper_floral', gen: (b) => misc.wallpaper(b, 1), seed: 84 },
  { id: 'wallpaper_70s', gen: (b) => misc.wallpaper(b, 2), seed: 85 },
  { id: 'oil_dado', gen: (b) => misc.oilDado(b), seed: 86, res: 0.5 },
  { id: 'oil_dado_brown', gen: (b) => misc.oilDado(b, '#5e4632'), seed: 87, res: 0.5 },
];

const byId = new Map(TEXTURE_DEFS.map((d) => [d.id, d]));

export function generateTexture(id: string, size: number): PackedTexture {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown texture ${id}`);
  const n = Math.max(64, Math.round(size * (def.res ?? 1)));
  const b = new TexBuilder(n, new Noise(def.seed ?? 1));
  def.gen(b);
  return b.pack();
}

export function textureResolution(id: string, size: number): number {
  const def = byId.get(id);
  return Math.max(64, Math.round(size * (def?.res ?? 1)));
}
