/**
 * Procedural texture sets that are replaced by CC0 photoscans (Poly Haven) when the
 * asset folder is present. Keys are procedural registry ids, so every material,
 * bark shader and terrain layer that uses the id picks up the scan automatically.
 * `scale` is the real-world tile size in metres (overrides the material's own scale).
 */
export interface PhotoOverride {
  photo: string;
  scale: number | [number, number];
  alphaMode?: 'height' | 'metal';
  /** Multiplier on the sRGB albedo (grading a scan towards the estate's palette). */
  tint?: [number, number, number];
}

export const PHOTO_OVERRIDES: Record<string, PhotoOverride> = {
  // masonry & plaster (the rendered façades stay procedural: ochre lime render with grey surrounds)
  brick: { photo: 'red_brick_plaster_patch_02', scale: 1.6 },
  stone_wall: { photo: 'old_stone_wall', scale: 2.2 },
  stone_slab: { photo: 'monastery_stone_floor', scale: 2.0, tint: [1.15, 1.12, 1.08] },
  concrete: { photo: 'concrete_wall_008', scale: 2.7 },
  roof_tiles: { photo: 'clay_roof_tiles_02', scale: 2.5, tint: [0.82, 0.78, 0.76] },
  plaster_int: { photo: 'painted_plaster_wall', scale: 2.2 },
  ceiling: { photo: 'painted_plaster_wall', scale: 2.4, tint: [0.97, 0.95, 0.9] },
  wallpaper_stripe: { photo: 'decrepit_wallpaper', scale: 2.5 },
  floor_tiles: { photo: 'worn_tile_floor', scale: 2.0 },
  linoleum: { photo: 'old_linoleum_flooring_01', scale: 2.0, tint: [0.85, 0.85, 0.85] },
  // wood
  floor_boards: { photo: 'old_wood_floor', scale: 3.0 },
  floor_boards_dark: { photo: 'old_wooden_floor_02', scale: 2.0 },
  parquet: { photo: 'herringbone_parquet', scale: 2.6, tint: [0.8, 0.76, 0.72] },
  barn_boards: { photo: 'weathered_planks', scale: 2.0 },
  painted_wood_green: { photo: 'wood_peeling_paint_weathered', scale: 0.9 },
  furniture_wood: { photo: 'wood_cabinet_worn_long', scale: [1, 0.5] },
  rough_timber: { photo: 'rough_wood', scale: 0.9 },
  // metal
  rust_metal: { photo: 'rusty_metal_02', scale: 1.0, alphaMode: 'metal' },
  corrugated: { photo: 'rusty_corrugated_iron', scale: 2.0 },
  // ground (terrain layers)
  forest_floor: { photo: 'forest_leaves_02', scale: 3.0 },
  meadow: { photo: 'withered_grass', scale: 2.4, tint: [0.78, 0.86, 0.6] },
  mud: { photo: 'brown_mud_leaves_01', scale: 2.0 },
  gravel: { photo: 'rock_ground', scale: 2.2 },
  asphalt: { photo: 'road_damaged', scale: 3.0 },
  rock: { photo: 'mossy_rock', scale: 3.0 },
  // bark (tube UVs are metric: u around the trunk, v along it)
  bark_spruce: { photo: 'pine_bark', scale: [1.2, 1.6], tint: [0.78, 0.74, 0.72] },
  bark_oak: { photo: 'bark_brown_02', scale: [0.9, 1.0] },
  bark_beech: { photo: 'tree_bark_03', scale: [1.0, 1.2] },
};
