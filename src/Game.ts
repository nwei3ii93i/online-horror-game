import * as THREE from 'three/webgpu';
import { Engine } from './core/Engine';
import { Settings } from './core/Settings';
import { TextureStore } from './materials/TextureStore';
import { MaterialLibrary } from './materials/MaterialLibrary';
import { worldUniforms } from './render/WorldUniforms';
import { Atmosphere } from './render/Atmosphere';
import { Volumetrics } from './render/Volumetrics';
import { TerrainData } from './world/TerrainData';
import { TerrainMesh } from './world/TerrainMesh';
import { WORLD_HALF, HOLES, POI } from './world/Layout';
import { Physics } from './physics/Physics';
import { PlayerController } from './gameplay/PlayerController';
import { Flashlight } from './gameplay/Flashlight';
import type { LoadingScreen } from './ui/LoadingScreen';
import { HUD } from './ui/HUD';
import { Forest } from './world/vegetation/Forest';
import { createVegTextures } from './world/vegetation/VegTextures';
import { World } from './world/World';
import { Interaction } from './gameplay/Interaction';
import { Doors } from './gameplay/Doors';
import { LocalWorldBridge, WorldBridge } from './gameplay/WorldBridge';

export interface GameOptions {
  seed: number;
  automation: URLSearchParams;
}

/**
 * Composition root: builds the shared world (identical for solo and multiplayer),
 * then attaches the local player. Networking plugs in through the session layer.
 */
export class Game {
  readonly engine: Engine;
  readonly physics = new Physics();
  textures!: TextureStore;
  materials!: MaterialLibrary;
  terrain!: TerrainData;
  terrainMesh!: TerrainMesh;
  atmosphere!: Atmosphere;
  volumetrics: Volumetrics | null = null;
  player!: PlayerController;
  flashlight!: Flashlight;
  world!: World;
  interaction!: Interaction;
  doors!: Doors;
  bridge: WorldBridge = new LocalWorldBridge();
  inventory = new Set<string>();
  hud!: HUD;
  forest!: Forest;

  constructor(container: HTMLElement, readonly settings: Settings, readonly opts: GameOptions) {
    this.engine = new Engine(container, settings);
  }

  async load(loading: LoadingScreen): Promise<void> {
    const q = this.settings.profile;
    loading.set(0.02, 'Initialising renderer');
    await this.engine.init();
    loading.set(0.05, `Renderer: ${this.engine.backend.toUpperCase()}`);

    this.textures = new TextureStore(q.textureSize, q.anisotropy);
    const texP = this.textures.loadAll((d, t, id) => loading.set(0.05 + 0.6 * (d / t), `Synthesising materials (${id})`));
    const terrainP = TerrainData.generateAsync(this.opts.seed);
    const physP = this.physics.init();
    const [terrain] = await Promise.all([terrainP, texP, physP]);
    this.terrain = terrain;

    loading.set(0.68, 'Shaping terrain');
    this.setupWorldMaps();
    this.materials = new MaterialLibrary(this.textures);
    const scene = this.engine.scene;
    this.atmosphere = new Atmosphere(scene, q);
    this.atmosphere.enableCSM(this.engine.camera, q);
    this.terrainMesh = new TerrainMesh(terrain, this.textures, HOLES);
    scene.add(this.terrainMesh.group);
    this.physics.addTerrain(terrain);
    for (const h of HOLES) this.physics.terrainExclusions.push({ rect: h, below: terrain.heightAt((h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2) + 0.4 });

    loading.set(0.8, 'Placing the estate');
    this.world = new World(this.physics, this.materials, terrain);
    this.world.build();
    this.world.applyInteriorMap();
    scene.add(this.world.group);
    this.interaction = new Interaction(this.physics);
    this.doors = new Doors(this.physics, this.materials, this.interaction, this.bridge);
    for (const d of this.world.doorSpecs) this.doors.add(d);
    scene.add(this.doors.group);

    loading.set(0.85, 'Growing the forest');
    await new Promise((r) => setTimeout(r, 0));
    const veg = createVegTextures();
    this.forest = new Forest(terrain, this.textures, veg, this.physics, q.vegetationDensity);
    scene.add(this.forest.group);
    console.log('trees', this.forest.totalTrees);

    loading.set(0.9, 'Lighting');
    this.player = new PlayerController(this.physics, this.engine.input, this.settings, this.engine.camera);
    const sp = POI.playerSpawn;
    this.player.init(sp.x, terrain.heightAt(sp.x, sp.z) + 0.05, sp.z, sp.rot);
    this.flashlight = new Flashlight(scene, q.flashlightShadowSize);
    this.engine.setupPost();
    if (q.volumetrics) {
      this.volumetrics = new Volumetrics(scene, q.volumetricSteps);
      this.volumetrics.setDepth(this.engine.post.depthNode);
    }
    this.hud = new HUD(document.body, this.engine.input, this.engine.renderer.domElement);
    this.registerSystems();
    this.applyAutomation();
    loading.set(1, 'Ready');
  }

  private setupWorldMaps(): void {
    const t = this.terrain;
    worldUniforms.setTerrain(t.heights, t.n, t.n, new THREE.Vector2(-WORLD_HALF, -WORLD_HALF), new THREE.Vector2(WORLD_HALF * 2, WORLD_HALF * 2));
  }

  private registerSystems(): void {
    const e = this.engine;
    const physics = this.physics;
    e.add({
      fixedUpdate: (dt) => {
        this.player.fixedUpdate(dt);
        this.doors.playerPos = this.player.position;
        this.doors.update(dt);
        physics.step();
      },
      update: (dt) => {
        this.player.update(dt);
        this.interaction.update(e.camera, this.player.rapierCollider);
        const ictx = { playerId: 'local', hasItem: (id: string) => this.inventory.has(id), point: this.interaction.focusPoint };
        this.hud.setPrompt(this.interaction.focused ? this.interaction.focused.prompt(ictx) : null);
        if (e.frame % 30 === 0) this.hud.setInfo(`${e.backend.toUpperCase()}  ${e.fps.toFixed(0)} fps`);
        if (e.input.wasPressed('interact') && this.interaction.focused) {
          this.interaction.focused.interact({ playerId: 'local', hasItem: (id) => this.inventory.has(id), point: this.interaction.focusPoint });
        }
        if (e.input.wasPressed('flashlight')) this.flashlight.toggle();
        const moving = Math.min(1, Math.hypot(this.player.velocity.x, this.player.velocity.z) / 2);
        this.flashlight.update(dt, e.camera, moving);
        this.atmosphere.update(dt, e.camera);
        this.volumetrics?.update(dt, e.camera);
        this.terrainMesh.update(e.camera.position, this.settings.profile.viewDistance);
        this.forest.update(e.camera, this.settings.profile.viewDistance, this.player.position);
        worldUniforms.windTime.value += dt;
      },
    });
  }

  /** URL-driven automation for screenshots / tests: ?cam=x,y,z,yawDeg,pitchDeg&noclip&wet=0.8 */
  private applyAutomation(): void {
    const a = this.opts.automation;
    const cam = a.get('cam');
    if (cam) {
      const [x, y, z, yaw, pitch] = cam.split(',').map(Number);
      // cam y is the eye height in world space
      this.player.noclip = !a.has('walk');
      this.player.teleport(x, y - this.player.eyeHeight, z, (yaw * Math.PI) / 180);
      this.player.pitch = ((pitch || 0) * Math.PI) / 180;
    }
    if (a.has('noclip')) this.player.noclip = true;
    if (cam || a.has('nohud')) this.hud.el.style.display = 'none';
    if (a.has('wet')) worldUniforms.wetness.value = Number(a.get('wet'));
    if (a.has('noflash')) this.flashlight.on = false;
    if (a.has('exposure')) this.engine.renderer.toneMappingExposure = Number(a.get('exposure'));
    if (a.has('moon')) this.atmosphere.moon.intensity = Number(a.get('moon'));
    if (a.has('hemi')) this.atmosphere.hemi.intensity = Number(a.get('hemi'));
    if (a.has('flash')) this.flashlight.intensity = Number(a.get('flash'));
  }

  start(): void {
    this.terrainMesh.warm(this.engine.camera.position, this.settings.profile.viewDistance);
    this.engine.start();
  }
}
