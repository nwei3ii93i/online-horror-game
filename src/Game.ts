import * as THREE from 'three/webgpu';
import { Engine } from './core/Engine';
import { Settings } from './core/Settings';
import { TextureStore } from './materials/TextureStore';
import { MaterialLibrary } from './materials/MaterialLibrary';
import { worldUniforms } from './render/WorldUniforms';
import { Atmosphere } from './render/Atmosphere';
import { Volumetrics } from './render/Volumetrics';
import { LAYER_VOLUMETRIC } from './render/PostFX';
import { TerrainData } from './world/TerrainData';
import { TerrainMesh } from './world/TerrainMesh';
import { WORLD_HALF, HOLES, POI, BUILDINGS } from './world/Layout';
import { Physics } from './physics/Physics';
import { PlayerController } from './gameplay/PlayerController';
import { Flashlight } from './gameplay/Flashlight';
import type { LoadingScreen } from './ui/LoadingScreen';
import { HUD } from './ui/HUD';
import { Forest } from './world/vegetation/Forest';
import { createVegTextures } from './world/vegetation/VegTextures';
import { GroundCover } from './world/vegetation/GroundCover';
import { AudioEngine, AmbienceDirector, playFootstep, playLanding } from './audio';
import { GROUP, groups } from './physics/Physics';
import { World } from './world/World';
import { Interaction } from './gameplay/Interaction';
import { Doors } from './gameplay/Doors';
import { LocalWorldBridge, WorldBridge } from './gameplay/WorldBridge';
import { LightPool } from './gameplay/LightPool';
import { AssetManager, ASSET_BASE } from './assets/AssetManager';
import { PropPlacer } from './world/props/PropPlacer';
import { MANOR_PROP_IDS, placeManorProps } from './world/props/ManorProps';

const VAN_CARGO = ['metal_tool_chest', 'cardboard_box_01', 'Lantern_01'];

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
  readonly assets = new AssetManager();
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
  props!: PropPlacer;
  lamps!: LightPool;
  bridge: WorldBridge = new LocalWorldBridge();
  inventory = new Set<string>();
  hud!: HUD;
  forest!: Forest;
  groundCover!: GroundCover;
  private adaptExposure = 1;
  audio!: AudioEngine;
  ambience!: AmbienceDirector;
  private indoorSmooth = 0;
  private _fwd = new THREE.Vector3();
  private _up = new THREE.Vector3();

  constructor(container: HTMLElement, readonly settings: Settings, readonly opts: GameOptions) {
    this.engine = new Engine(container, settings);
  }

  async load(loading: LoadingScreen): Promise<void> {
    const q = this.settings.profile;
    loading.set(0.02, 'Initialising renderer');
    await this.engine.init();
    loading.set(0.05, `Renderer: ${this.engine.backend.toUpperCase()}`);

    this.textures = new TextureStore(q.textureSize, q.anisotropy);
    await this.assets.init();
    const photos = this.opts.automation.has('nophoto') ? {} : this.assets.manifest.textures;
    const texP = this.textures.loadAll((d, t, id) => loading.set(0.05 + 0.6 * (d / t), `Preparing materials (${id})`), photos, ASSET_BASE);
    const propsP = this.opts.automation.has('noprops') ? Promise.resolve() : this.assets.preload([...MANOR_PROP_IDS, ...VAN_CARGO]);
    const terrainP = TerrainData.generateAsync(this.opts.seed);
    const physP = this.physics.init();
    this.audio = new AudioEngine({ masterVolume: this.settings.values.masterVolume });
    const audioP = this.audio.init(() => undefined);
    const [terrain] = await Promise.all([terrainP, texP, physP, audioP]);
    this.ambience = new AmbienceDirector(this.audio);
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
    loading.set(0.82, 'Furnishing');
    await propsP;
    this.props = new PropPlacer(this.assets, this.physics);
    placeManorProps(this.props);
    // the group's gear in the van
    const vanProps = new PropPlacer(this.assets);
    this.world.van.cargo.forEach((c, i) => vanProps.place(VAN_CARGO[i], c.x, c.y, c.z, c.ry, { collider: 'none' }));
    scene.add(vanProps.group);
    scene.add(this.props.group);
    this.interaction = new Interaction(this.physics);
    this.doors = new Doors(this.physics, this.materials, this.interaction, this.bridge);
    for (const d of this.world.doorSpecs) this.doors.add(d);
    scene.add(this.doors.group);

    loading.set(0.85, 'Growing the forest');
    await new Promise((r) => setTimeout(r, 0));
    const veg = createVegTextures();
    this.forest = new Forest(terrain, this.textures, veg, this.physics, q.vegetationDensity);
    scene.add(this.forest.group);
    this.groundCover = new GroundCover(terrain, this.textures, this.materials, veg, this.physics, q.vegetationDensity);
    scene.add(this.groundCover.group);
    console.log('trees', this.forest.totalTrees);

    loading.set(0.9, 'Lighting');
    this.player = new PlayerController(this.physics, this.engine.input, this.settings, this.engine.camera);
    // everyone starts beside the van's open sliding door (slot 0 = local solo player)
    const sp = this.world.van?.spawn[0] ?? POI.playerSpawn;
    this.player.init(sp.x, terrain.heightAt(sp.x, sp.z) + 0.05, sp.z, sp.rot);
    this.setupVanLights();
    this.lamps = new LightPool(scene, this.world.lightFixtures, this.world.rooms, this.materials);
    this.flashlight = new Flashlight(scene, q.flashlightShadowSize);
    this.engine.setupPost();
    if (q.volumetrics) {
      this.volumetrics = new Volumetrics(scene, q.volumetricSteps);
      this.volumetrics.setDepth(this.engine.post.depthNode);
    }
    this.hud = new HUD(document.body, this.engine.input, this.engine.renderer.domElement);
    this.setupAudio();
    this.registerSystems();
    this.applyAutomation();
    // compile every pipeline now instead of hitching when things first come into view
    loading.set(0.97, 'Compiling shaders');
    this.forest.prepareWarmup(true);
    this.groundCover.prepareWarmup(true);
    try { await this.engine.renderer.compileAsync(scene, this.engine.camera); } catch (err) { console.warn('compileAsync failed', err); }
    this.forest.prepareWarmup(false);
    this.groundCover.prepareWarmup(false);
    loading.set(1, 'Ready');
  }

  /** Dipped headlights left on: the only warm light outside, scattering in the fog. */
  private setupVanLights(): void {
    const van = this.world.van;
    if (!van) return;
    const h = van.headlight;
    const spot = new THREE.SpotLight(0xffe2b0, 260, 55, 0.42, 0.55, 1.6);
    spot.position.copy(h.pos);
    spot.target.position.copy(h.pos).addScaledVector(h.dir, 20);
    spot.castShadow = true;
    spot.shadow.mapSize.set(512, 512);
    spot.shadow.bias = -0.0006;
    spot.shadow.camera.near = 0.3;
    spot.shadow.camera.far = 55;
    spot.layers.enable(LAYER_VOLUMETRIC);
    this.engine.scene.add(spot, spot.target);
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
        if (e.input.wasPressed('flashlight')) { this.flashlight.toggle(); this.audio.play('flashlight_click'); }
        const moving = Math.min(1, Math.hypot(this.player.velocity.x, this.player.velocity.z) / 2);
        this.flashlight.update(dt, e.camera, moving);
        this.lamps.update(dt, e.camera.position);
        this.updateEyeAdaptation(dt);
        this.atmosphere.update(dt, e.camera);
        this.volumetrics?.update(dt, e.camera);
        this.terrainMesh.update(e.camera.position, this.settings.profile.viewDistance);
        this.forest.update(e.camera, this.settings.profile.viewDistance, this.player.position);
        this.groundCover.update(this.player.position);
        // interior dressing is only visible through windows from close by – skip it beyond that
        const c = e.camera.position, M = BUILDINGS.manor;
        const dx = Math.max(M.x0 - c.x, 0, c.x - M.x1), dz = Math.max(M.z0 - c.z, 0, c.z - M.z1);
        this.props.group.visible = dx * dx + dz * dz < 22 * 22;
        worldUniforms.windTime.value += dt;
        this.updateAudio(dt);
      },
    });
  }

  /** Wire gameplay events to the procedural sound engine. */
  private setupAudio(): void {
    const a = this.audio;
    const wet = () => worldUniforms.wetness.value > 0.3;
    const surf = (s: string, p: THREE.Vector3) => (s === 'terrain' ? `terrain:${this.terrain.surfaceAt(p.x, p.z)}` : s);
    this.player.onFootstep = (ev) => playFootstep(a, surf(ev.surface, ev.position), ev.position, ev.intensity, ev.stance, wet());
    this.player.onLand = (speed, s) => playLanding(a, surf(s, this.player.position), this.player.position.clone(), speed, wet());
    this.doors.events.on('creak', (ev) => a.play(ev.kind === 'metal' ? 'gate_iron_creak' : 'door_open_creak', { position: ev.position }));
    this.doors.events.on('close', (ev) => a.play('door_close', { position: ev.position }));
    this.doors.events.on('locked', (ev) => a.play('door_locked', { position: ev.position }));
    this.doors.events.on('unlock', (ev) => a.play('door_unlock', { position: ev.position }));
    const d = new THREE.Vector3();
    const mask = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.DOOR);
    a.setOcclusionProvider((from, to) => {
      d.subVectors(to, from);
      const len = d.length();
      if (len < 0.5) return 0;
      d.divideScalar(len);
      const hit = this.physics.raycast(from, d, len - 0.3, mask);
      if (!hit) return 0;
      const back = this.physics.raycast(to, d.clone().negate(), len - 0.3, mask);
      return back && len - back.toi - hit.toi > 0.6 ? 0.9 : 0.65;
    });
    const unlock = () => void a.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.settings.onChange((s) => a.setMasterVolume(s.masterVolume));
  }

  private updateAudio(dt: number): void {
    const cam = this.engine.camera;
    cam.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, this._fwd, this._up);
    const room = this.world.roomAt(this.player.position);
    this.indoorSmooth += ((room ? 1 : 0) - this.indoorSmooth) * Math.min(1, dt * 2);
    const trees = this.forest.densityAt(cam.position.x, cam.position.z);
    const env = room ? room.env : trees > 0.35 ? 'forest' : 'outdoor';
    this.ambience.update(dt, {
      listener: cam.position, indoor: this.indoorSmooth, environment: env,
      rain: worldUniforms.rainIntensity.value, wind: worldUniforms.windStrength.value,
      time: this.engine.time, isNearTrees: trees > 0.2,
      // only real exhaustion should be audible
      exertion: Math.max(0, (0.4 - this.player.stamina) / 0.4),
    });
    this.audio.update(dt);
  }

  /**
   * Cheap eye adaptation: when the torch lights a surface very close to the eye the
   * camera "stops down", in wide dark spaces it opens up slightly. Smoothed over time.
   */
  private updateEyeAdaptation(dt: number): void {
    const cam = this.engine.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.physics.raycast({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: dir.x, y: dir.y, z: dir.z }, 12, undefined, this.player.rapierCollider);
    const d = hit ? hit.toi : 12;
    const torch = this.flashlight.on ? 1 : 0;
    // close surfaces under the torch → lower exposure; nothing lit → open up a little
    const target = torch ? THREE.MathUtils.lerp(0.42, 1.0, THREE.MathUtils.smoothstep(d, 0.4, 4.5)) : 1.12;
    const rate = target < this.adaptExposure ? 6 : 1.2; // close down fast, open up slowly
    this.adaptExposure += (target - this.adaptExposure) * Math.min(1, dt * rate);
    this.engine.post.exposureBoost.value = this.adaptExposure;
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
