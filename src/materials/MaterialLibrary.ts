import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, vec4, float, positionWorld, normalWorld, mix, smoothstep, clamp, sqrt, max, dot,
  normalMap, mx_noise_float, attribute, uniform, color as tslColor,
} from 'three/tsl';
import { TextureStore } from './TextureStore';
import { worldUniforms } from '../render/WorldUniforms';

export interface MatSpec {
  /** Texture set id from the procedural registry. */
  tex?: string;
  /** World metres covered by one texture tile (geometry UVs are in metres). */
  scale?: number | [number, number];
  /** sRGB tint multiplied onto the albedo. */
  color?: string;
  roughness?: number;
  roughnessAdd?: number;
  metalness?: number;
  normalScale?: number;
  /** Outdoor surface: receives rain wetness and ground-contact grime. */
  exterior?: boolean;
  /** Anti-tiling macro variation strength. */
  macro?: number;
  /** Moss growth on up-facing surfaces (0..1). */
  mossUp?: number;
  /** Ground material: puddles collect in low areas of the height map when wet. */
  puddles?: boolean;
  /** Multiply albedo with the geometry's `color` attribute. */
  vertexColors?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Fraction of ground-contact grime. */
  groundDirt?: number;
  depthWrite?: boolean;
  /** Use physical material (clearcoat etc). */
  clearcoat?: number;
}

/** Catalogue of every surface used in the world. Keys are referenced by builders. */
export const MATERIALS: Record<string, MatSpec> = {
  // --- façades & masonry
  plaster_ext: { tex: 'plaster_ext', scale: 4, exterior: true, groundDirt: 1 },
  plaster_ext_grey: { tex: 'plaster_ext_grey', scale: 4, exterior: true, groundDirt: 1 },
  plaster_ext_ochre: { tex: 'plaster_ext', scale: 4, exterior: true, groundDirt: 1, color: '#e8d6b0' },
  brick: { tex: 'brick', scale: 2.08, exterior: true, groundDirt: 1, mossUp: 0.5 },
  brick_int: { tex: 'brick', scale: 2.08, color: '#c8c0b8' },
  stone_wall: { tex: 'stone_wall', scale: 3, exterior: true, groundDirt: 0.8, mossUp: 0.9 },
  stone_wall_int: { tex: 'stone_wall', scale: 3, color: '#b8b4ac' },
  stone_slab: { tex: 'stone_slab', scale: 2, exterior: true, groundDirt: 0.6, mossUp: 0.35, puddles: true },
  concrete: { tex: 'concrete', scale: 4, exterior: true, groundDirt: 1, mossUp: 0.4 },
  concrete_int: { tex: 'concrete', scale: 4 },
  roof_tiles: { tex: 'roof_tiles', scale: 2, exterior: true, normalScale: 1.2 },
  // --- interior walls / floors / ceilings
  plaster_int: { tex: 'plaster_int', scale: 3 },
  plaster_int_blue: { tex: 'plaster_int', scale: 3, color: '#b9c4c8' },
  plaster_int_green: { tex: 'plaster_int', scale: 3, color: '#c2cbb2' },
  ceiling: { tex: 'ceiling', scale: 3 },
  wallpaper_stripe: { tex: 'wallpaper_stripe', scale: 2 },
  wallpaper_floral: { tex: 'wallpaper_floral', scale: 2 },
  wallpaper_70s: { tex: 'wallpaper_70s', scale: 2 },
  oil_dado: { tex: 'oil_dado', scale: 2 },
  oil_dado_brown: { tex: 'oil_dado_brown', scale: 2 },
  wall_tiles: { tex: 'wall_tiles', scale: 1.5 },
  floor_tiles: { tex: 'floor_tiles', scale: 2 },
  floor_boards: { tex: 'floor_boards', scale: 2 },
  floor_boards_dark: { tex: 'floor_boards_dark', scale: 2 },
  parquet: { tex: 'parquet', scale: 1.28 },
  linoleum: { tex: 'linoleum', scale: 2 },
  wainscot: { tex: 'wainscot', scale: 1 },
  // --- wood
  barn_boards: { tex: 'barn_boards', scale: 3, exterior: true, groundDirt: 1 },
  barn_boards_int: { tex: 'barn_boards', scale: 3, color: '#a8a8a8' },
  painted_wood_white: { tex: 'painted_wood_white', scale: 1 },
  painted_wood_white_ext: { tex: 'painted_wood_white', scale: 1, exterior: true },
  painted_wood_green: { tex: 'painted_wood_green', scale: 1, exterior: true },
  painted_wood_brown: { tex: 'painted_wood_brown', scale: 1 },
  painted_wood_brown_ext: { tex: 'painted_wood_brown', scale: 1, exterior: true },
  furniture_wood: { tex: 'furniture_wood', scale: 1, vertexColors: true },
  furniture_oak: { tex: 'furniture_oak', scale: 1, vertexColors: true },
  rough_timber: { tex: 'rough_timber', scale: 1.2, vertexColors: true },
  rough_timber_ext: { tex: 'rough_timber', scale: 1.2, exterior: true, mossUp: 0.6 },
  // --- metal
  rust_metal: { tex: 'rust_metal', scale: 1, exterior: true, vertexColors: true },
  rust_metal_int: { tex: 'rust_metal', scale: 1, vertexColors: true },
  painted_metal: { tex: 'painted_metal', scale: 1, vertexColors: true },
  painted_metal_ext: { tex: 'painted_metal', scale: 1, exterior: true },
  painted_metal_cream: { tex: 'painted_metal_cream', scale: 1, vertexColors: true },
  corrugated: { tex: 'corrugated', scale: 2, exterior: true },
  chrome: { color: '#c8c8c8', roughness: 0.25, metalness: 1 },
  brass: { color: '#a08048', roughness: 0.4, metalness: 1 },
  iron_black: { color: '#262624', roughness: 0.6, metalness: 0.7, exterior: true },
  // --- textiles & soft
  fabric_brown: { tex: 'fabric_brown', scale: 0.5, vertexColors: true },
  fabric_green: { tex: 'fabric_green', scale: 0.5, vertexColors: true },
  fabric_red: { tex: 'fabric_red', scale: 0.5, vertexColors: true },
  fabric_check: { tex: 'fabric_check', scale: 0.5, vertexColors: true },
  fabric_white: { tex: 'fabric_white', scale: 0.5, vertexColors: true },
  cardboard: { tex: 'cardboard', scale: 1, vertexColors: true },
  hay: { tex: 'hay', scale: 1, exterior: true },
  // --- ground & nature (non-terrain uses)
  forest_floor: { tex: 'forest_floor', scale: 4, exterior: true, puddles: true },
  gravel: { tex: 'gravel', scale: 3, exterior: true, puddles: true },
  mud: { tex: 'mud', scale: 4, exterior: true, puddles: true },
  rock: { tex: 'rock', scale: 3, exterior: true, mossUp: 0.8 },
  bark_spruce: { tex: 'bark_spruce', scale: [1, 2], exterior: true, macro: 0.15 },
  bark_beech: { tex: 'bark_beech', scale: [1, 2], exterior: true, macro: 0.15 },
  bark_birch: { tex: 'bark_birch', scale: [1, 2], exterior: true, macro: 0.1 },
  bark_oak: { tex: 'bark_oak', scale: [1, 2], exterior: true, macro: 0.15 },
  deadwood: { tex: 'deadwood', scale: [1, 2], exterior: true, mossUp: 0.7 },
  moss: { tex: 'moss', scale: 2, exterior: true },
  // --- simple
  ceramic_white: { color: '#d8d4c8', roughness: 0.15, clearcoat: 0.5 },
  porcelain: { color: '#e4e0d4', roughness: 0.2, clearcoat: 0.6 },
  rubber_black: { color: '#1a1a1a', roughness: 0.85 },
  plastic_bakelite: { color: '#2a1c14', roughness: 0.35 },
  paper: { color: '#cfc6b0', roughness: 0.9, vertexColors: true },
  black_soot: { color: '#121110', roughness: 0.95 },
  candle: { color: '#d8d0b8', roughness: 0.6 },
};

/**
 * Creates (and caches) node materials for world surfaces.
 * All textured materials share one graph template: albedo/height + normal/rough/ao maps,
 * macro anti-tiling noise, wetness, puddles, ground grime, moss and interior darkening.
 */
export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  private glass?: THREE.Material;

  constructor(private textures: TextureStore) {}

  get(name: string): THREE.Material {
    let m = this.cache.get(name);
    if (!m) {
      const spec = MATERIALS[name];
      if (!spec) throw new Error(`Unknown material '${name}'`);
      m = this.create(name, spec);
      this.cache.set(name, m);
    }
    return m;
  }

  /** Register an ad-hoc material spec (e.g. from a GLTF asset or a prop variant). */
  define(name: string, spec: MatSpec): void {
    MATERIALS[name] = spec;
    this.cache.delete(name);
  }

  has(name: string): boolean { return name in MATERIALS; }

  create(name: string, spec: MatSpec): THREE.Material {
    const mat = spec.clearcoat ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
    mat.name = name;
    // exterior surfaces never see the interior lamps (see Game.assignLightSets)
    if (spec.exterior) mat.userData.exterior = true;
    if (spec.side !== undefined) mat.side = spec.side;
    if (spec.transparent) { mat.transparent = true; mat.opacity = spec.opacity ?? 1; }
    if (spec.depthWrite === false) mat.depthWrite = false;
    if (spec.alphaTest) mat.alphaTest = spec.alphaTest;
    if (spec.clearcoat && mat instanceof THREE.MeshPhysicalNodeMaterial) {
      mat.clearcoat = spec.clearcoat;
      mat.clearcoatRoughness = 0.2;
    }

    const W = worldUniforms;
    const pw = positionWorld;
    const tint: any = spec.color ? tslColor(new THREE.Color(spec.color)) : vec3(1);
    const indoor = spec.exterior ? W.indoorAt() : float(1);

    let albedo: any;
    let rough: any;
    let ao: any = float(1);
    let metal: any = float(spec.metalness ?? 0);
    let height: any = float(0.5);
    let normalTex: any = null;

    if (spec.tex) {
      const set = this.textures.get(spec.tex);
      // photoscans carry their real-world size; tints still apply on top
      const sc = set.scale ?? spec.scale ?? 1;
      const su = Array.isArray(sc) ? sc[0] : sc;
      const sv = Array.isArray(sc) ? sc[1] : sc;
      const tuv = uv().div(vec2(su, sv));
      const A = texture(set.a, tuv);
      const B = texture(set.b, tuv);
      albedo = A.rgb.mul(tint);
      rough = B.z.mul(spec.roughness ?? 1).add(spec.roughnessAdd ?? 0);
      ao = B.w;
      if (set.alphaMode === 'metal') metal = A.a.mul(spec.metalness ?? 1);
      if (set.alphaMode === 'height') height = A.a;
      const nxy = B.xy.mul(2).sub(1);
      const nz = sqrt(max(float(1).sub(dot(nxy, nxy)), 0.0));
      normalTex = vec3(B.x, B.y, nz.mul(0.5).add(0.5));
    } else {
      albedo = tint;
      rough = float(spec.roughness ?? 0.8);
    }

    if (spec.vertexColors) albedo = albedo.mul(attribute('color', 'vec3'));

    // Macro variation to break tiling (two octaves of world-space noise)
    const macro = spec.macro ?? (spec.tex ? 0.22 : 0);
    if (macro > 0) {
      const m1 = W.noise(pw, 0.21);
      const m2 = W.noise(pw.add(17.3), 0.9);
      albedo = albedo.mul(float(1).add(m1.mul(macro)).add(m2.mul(macro * 0.35)));
      rough = rough.add(m1.mul(macro * 0.15));
    }

    // Moss on up-facing surfaces
    if (spec.mossUp && spec.mossUp > 0) {
      const mossSet = this.textures.get('moss');
      const muv = pw.xz.div(1.6);
      const mossA = texture(mossSet.a, muv);
      const up = smoothstep(0.35, 0.85, normalWorld.y);
      const n = smoothstep(-0.25, 0.35, W.noise(pw, 0.55));
      const mm = clamp(up.mul(n).mul(spec.mossUp), 0, 1);
      albedo = mix(albedo, mossA.rgb, mm);
      rough = mix(rough, 0.95, mm);
    }

    let normalScale: any = float(spec.normalScale ?? 1);

    if (spec.exterior) {
      const outdoor = float(1).sub(indoor);
      // Ground-contact grime: splash zone darkening with a green-brown tinge
      if (spec.groundDirt) {
        const gc = W.groundContact(0.7).mul(spec.groundDirt).mul(outdoor);
        albedo = mix(albedo, albedo.mul(vec3(0.42, 0.42, 0.34)), gc.mul(0.8));
        rough = mix(rough, 0.95, gc.mul(0.5));
      }
      // Rain wetness
      const facing = clamp(normalWorld.y.mul(0.5).add(0.5), 0, 1);
      const wet = W.wetness.mul(outdoor).mul(mix(0.45, 1.0, facing));
      const porosity = clamp(rough, 0.2, 1.0);
      albedo = albedo.mul(mix(float(1), float(0.62), wet.mul(porosity)));
      rough = mix(rough, 0.14, wet.mul(0.8));
      if (spec.puddles) {
        const pud = smoothstep(0.42, 0.3, height).mul(smoothstep(0.15, 0.6, W.wetness)).mul(outdoor).mul(smoothstep(0.7, 0.95, normalWorld.y));
        albedo = mix(albedo, albedo.mul(0.45), pud);
        rough = mix(rough, 0.03, pud);
        normalScale = normalScale.mul(float(1).sub(pud.mul(0.95)));
      }
    }

    mat.colorNode = vec4(albedo, spec.transparent ? float(spec.opacity ?? 1) : float(1));
    mat.roughnessNode = clamp(rough, 0.02, 1);
    mat.metalnessNode = clamp(metal, 0, 1);
    if (normalTex) mat.normalNode = normalMap(normalTex, vec2(normalScale, normalScale));
    // sky/env light dies inside buildings
    const interior = spec.exterior ? indoor : W.indoorAt();
    mat.aoNode = ao.mul(mix(float(1), W.indoorAmbient, interior));
    if (spec.emissive) {
      (mat as any).emissiveNode = tslColor(new THREE.Color(spec.emissive)).mul(spec.emissiveIntensity ?? 1);
    }
    return mat;
  }

  /** Window glass: thin, dirty, slightly reflective. */
  getGlass(): THREE.Material {
    if (this.glass) return this.glass;
    const set = this.textures.get('glass_dirt');
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = 'glass';
    mat.transparent = true;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = false;
    const A = texture(set.a, uv().div(1.0));
    const dirt = A.a;
    const wet = worldUniforms.wetness.mul(float(1).sub(worldUniforms.indoorAt()));
    mat.colorNode = vec4(mix(vec3(0.03, 0.035, 0.04), A.rgb.mul(0.6), dirt), mix(float(0.12), float(0.85), dirt).add(wet.mul(0.05)));
    mat.roughnessNode = mix(float(0.04), float(0.85), dirt);
    mat.metalnessNode = float(0);
    this.glass = mat;
    return mat;
  }

  /** Emissive bulb glass etc. Intensity is driven via a uniform so lights can flicker. */
  emissive(name: string, colorHex: string, intensity: any): THREE.Material {
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = name;
    mat.colorNode = tslColor(new THREE.Color(colorHex));
    (mat as any).emissiveNode = tslColor(new THREE.Color(colorHex)).mul(intensity);
    mat.roughnessNode = float(0.3);
    return mat;
  }
}
