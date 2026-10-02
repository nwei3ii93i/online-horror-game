import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
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
import { WORLD_HALF, HOLES, POI, BUILDINGS, Rect } from './world/Layout';
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
import { Pickups } from './gameplay/Pickups';
import { DocumentReader } from './ui/DocumentReader';
import { MANOR_DOCS, placeDocuments } from './world/story/DocumentProps';
import { buildStoryDressing } from './world/story/Dressing';
import { AssetManager, ASSET_BASE } from './assets/AssetManager';
import { MANOR } from './world/buildings/Manor';
import { PropPlacer } from './world/props/PropPlacer';
import { MANOR_PROP_IDS, placeManorProps } from './world/props/ManorProps';
import { SACRED_PROP_IDS, placeSacredProps } from './world/props/SacredProps';
import { SACRED_DOCS } from './world/story/SacredDocs';
import { OUTBUILDING_PROP_IDS, placeOutbuildingProps } from './world/props/OutbuildingProps';
import { OUTBUILDING_DOCS } from './world/story/OutbuildingDocs';
import { CARETAKER_PROP_IDS, caretakerProps } from './world/props/CaretakerProps';
import { caretakerDocs } from './world/story/CaretakerDocs';

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
  reader!: DocumentReader;
  private readerClosedAt = 0;
  private propCullTimer = 0;
  /** Prop placers per building with the footprint used for proximity culling. */
  private propSets: { placer: PropPlacer; rect: Rect | null; range: number }[] = [];
  private docMeshes = new THREE.Group();
  /** Interior-only groups (documents, story dressing, lamp fixtures) hidden away from the house. */
  private interiorGroups: THREE.Object3D[] = [];
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
    const propsP = this.opts.automation.has('noprops') ? Promise.resolve() : this.assets.preload([...MANOR_PROP_IDS, ...SACRED_PROP_IDS, ...OUTBUILDING_PROP_IDS, ...CARETAKER_PROP_IDS, ...VAN_CARGO]);
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
    if (this.world.van) {
      const vanProps = new PropPlacer(this.assets);
      this.world.van.cargo.forEach((c, i) => vanProps.place(VAN_CARGO[i], c.x, c.y, c.z, c.ry, { collider: 'none' }));
      scene.add(vanProps.group);
    }
    scene.add(this.props.group);
    this.propSets.push({ placer: this.props, rect: BUILDINGS.manor, range: 16 });
    // garden, chapel, cemetery and hunting stand: scattered, so only per-prop distance culling
    const sacred = new PropPlacer(this.assets, this.physics);
    placeSacredProps(sacred);
    scene.add(sacred.group);
    this.propSets.push({ placer: sacred, rect: null, range: 45 });
    // workshop, barn, pump house and tunnels
    const outbuildings = new PropPlacer(this.assets, this.physics);
    placeOutbuildingProps(outbuildings);
    scene.add(outbuildings.group);
    this.propSets.push({ placer: outbuildings, rect: null, range: 28 });
    // caretaker's house, gate, mailbox and woodshed
    const caretaker = new PropPlacer(this.assets, this.physics);
    for (const [id, x, y, z, ry = 0, o = {}] of caretakerProps((x, z) => terrain.heightAt(x, z))) caretaker.place(id, x, y, z, ry, o);
    scene.add(caretaker.group);
    this.propSets.push({ placer: caretaker, rect: null, range: 26 });
    this.interaction = new Interaction(this.physics);
    this.doors = new Doors(this.physics, this.materials, this.interaction, this.bridge);
    for (const d of this.world.doorSpecs) this.doors.add(d);
    scene.add(this.doors.group);
    this.reader = new DocumentReader(document.body);
    this.reader.onClose = () => { this.readerClosedAt = performance.now(); };
    this.docMeshes = placeDocuments([...MANOR_DOCS, ...SACRED_DOCS, ...OUTBUILDING_DOCS, ...caretakerDocs((x, z) => terrain.heightAt(x, z))], this.physics, this.interaction, (d) => this.reader.open(d));
    const pickups = new Pickups(this.physics, this.interaction, (item) => {
      this.inventory.add(item);
      this.audio.play('key_pickup', { volume: 0.8 });
    });
    pickups.addKeys(this.world.buildings.flatMap((b) => b.anchors));
    scene.add(pickups.group);
    const dressing = buildStoryDressing(this.materials, this.physics);
    scene.add(this.docMeshes, dressing);
    this.interiorGroups.push(dressing);

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
    const sp = this.world.van?.spawn[0] ?? POI.arrival;
    this.player.init(sp.x, terrain.heightAt(sp.x, sp.z) + 0.05, sp.z, sp.rot);
    this.setupVanLights();
    this.lamps = new LightPool(scene, this.world.lightFixtures, this.world.rooms, this.materials, q.lampLights, q.lampShadowSize);
    this.interiorGroups.push(this.lamps.group);
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
    this.assignLightSets();
    // compile every pipeline now instead of hitching when things first come into view
    loading.set(0.97, 'Compiling shaders');
    this.forest.prepareWarmup(true);
    this.groundCover.prepareWarmup(true);
    try { await this.engine.renderer.compileAsync(scene, this.engine.camera); } catch (err) { console.warn('compileAsync failed', err); }
    this.forest.prepareWarmup(false);
    this.groundCover.prepareWarmup(false);
    loading.set(1, 'Ready');
  }

  /**
   * Exterior materials (terrain, vegetation, façades) get a light list without the interior
   * lamp pool: those point lights (with cube shadows) never reach them, so skipping them
   * saves their evaluation on most outdoor pixels.
   */
  private assignLightSets(): void {
    const scene = this.engine.scene;
    const pool = new Set<THREE.Object3D>(this.lamps.lights);
    const outdoor: THREE.Light[] = [];
    scene.traverse((o) => { if ((o as THREE.Light).isLight && !pool.has(o)) outdoor.push(o as THREE.Light); });
    const node = lights(outdoor);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.userData.exterior) (mat as any).lightsNode = node;
    });
  }

  /** Dipped headlights left on: the only warm light outside, scattering in the fog. */
  private setupVanLights(): void {
    const van = this.world.van;
    if (!van) return;
    const h = van.headlight;
    const spot = new THREE.SpotLight(0xffe2b0, 260, 55, 0.42, 0.55, 1.6);
    spot.position.copy(h.pos);
    spot.target.position.copy(h.pos).addScaledVector(h.dir, 20);
    spot.castShadow = this.settings.profile.lampShadowSize > 0;
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
        const reading = this.reader.isOpen;
        if (!reading) this.player.update(dt);
        this.interaction.update(e.camera, this.player.rapierCollider);
        const ictx = { playerId: 'local', hasItem: (id: string) => this.inventory.has(id), point: this.interaction.focusPoint };
        this.hud.setPrompt(this.interaction.focused && !reading ? this.interaction.focused.prompt(ictx) : null);
        if (e.frame % 30 === 0) {
          const ri = e.renderer.info.render as any;
          this.hud.setInfo(`${e.backend.toUpperCase()}  ${e.fps.toFixed(0)} fps  ·  ${Math.round(e.dynScale * this.settings.profile.renderScale * 100)}% res  ·  ${ri.drawCalls ?? ri.calls} calls  ·  ${(ri.triangles / 1e6).toFixed(2)}M tris`);
        }
        if (e.input.wasPressed('interact') && this.interaction.focused && !reading && performance.now() - this.readerClosedAt > 300) {
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
        // interior dressing: distance + storey culling (also keeps it out of the shadow passes)
        this.propCullTimer -= dt;
        if (this.propCullTimer <= 0) {
          this.propCullTimer = 0.2;
          const c = e.camera.position;
          const room = this.world.roomAt(c);
          const floorY = room ? room.y0 : null;
          const nearRect = (r: Rect) => {
            const dx = Math.max(r.x0 - c.x, 0, c.x - r.x1), dz = Math.max(r.z0 - c.z, 0, c.z - r.z1);
            return dx * dx + dz * dz < 22 * 22;
          };
          // each building's dressing is only visible through its windows from close by
          for (const b of this.propSets) {
            const near = b.rect ? nearRect(b.rect) : true;
            b.placer.group.visible = near;
            if (near) b.placer.cull(c, b.range, floorY);
          }
          const nearManor = nearRect(BUILDINGS.manor);
          for (const g of this.interiorGroups) g.visible = nearManor;
          for (const d of this.docMeshes.children) d.visible = d.position.distanceToSquared(c) < 20 * 20;
          this.doors.cull(c, 24, floorY, (x, z) => this.terrain.heightAt(x, z));
        }
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
    // recorded CC0 samples (Kenney) replace the synthesised door / paper sounds where present
    void a.loadSamples(`${ASSET_BASE}audio/`, { door_open_creak: 4, door_close: 4, door_locked: 2, door_unlock: 1, latch: 2, page_turn: 2, paper_rustle: 2 });
    this.doors.events.on('creak', (ev) => a.play(ev.kind === 'metal' ? 'gate_iron_creak' : 'door_open_creak', { position: ev.position, volume: 0.85, pitch: ev.kind === 'metal' ? 1 : 0.9 + Math.random() * 0.2 }));
    this.doors.events.on('close', (ev) => a.play('door_close', { position: ev.position, volume: 0.8 }));
    this.reader.onOpen = () => a.play('page_turn', { volume: 0.6 });
    const prevClose = this.reader.onClose;
    this.reader.onClose = () => { prevClose?.(); a.play('paper_rustle', { volume: 0.55 }); };
    // a clock that still ticks in an empty house; lamps hum where the generator feeds them
    a.play('clock_tick_loop', { position: new THREE.Vector3(-2.43, MANOR.G0 + 1.6, -21.4), loop: true, volume: 0.5, refDistance: 1.2, maxDistance: 14 });
    for (const f of this.world.lightFixtures) if (f.working && f.kind !== 'candle' && f.kind !== 'lantern') a.play('bulb_buzz_loop', { position: f.position.clone(), loop: true, volume: 0.35, refDistance: 0.8, maxDistance: 8 });
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
    this.flashlight.setBounce(hit ? cam.position.clone().addScaledVector(dir, hit.toi) : null, d, dir);
    const torch = this.flashlight.on ? 1 : 0;
    // close surfaces under the torch → lower exposure; nothing lit → open up a little
    const target = torch ? THREE.MathUtils.lerp(0.42, 1.0, THREE.MathUtils.smoothstep(d, 0.4, 4.5)) : 1.12;
    const rate = target < this.adaptExposure ? 6 : 1.2; // close down fast, open up slowly
    this.adaptExposure += (target - this.adaptExposure) * Math.min(1, dt * rate);
    this.engine.post.exposureBoost.value = this.adaptExposure;
  }

  /** Debug / tour helper: put the eye at (x, y, z) world space, yaw/pitch in degrees. */
  setCamera(x: number, y: number, z: number, yawDeg: number, pitchDeg = 0, noclip = true): void {
    this.player.noclip = noclip;
    this.player.teleport(x, y - this.player.eyeHeight, z, (yawDeg * Math.PI) / 180);
    this.player.pitch = (pitchDeg * Math.PI) / 180;
  }

  /** URL-driven automation for screenshots / tests: ?cam=x,y,z,yawDeg,pitchDeg&noclip&wet=0.8 */
  private applyAutomation(): void {
    const a = this.opts.automation;
    const cam = a.get('cam');
    if (cam) {
      const [x, y, z, yaw, pitch] = cam.split(',').map(Number);
      this.setCamera(x, y, z, yaw, pitch, !a.has('walk'));
    }
    if (a.has('noclip')) this.player.noclip = true;
    if (cam || a.has('nohud')) this.hud.el.style.display = 'none';
    if (a.has('wet')) worldUniforms.wetness.value = Number(a.get('wet'));
    if (a.has('noflash')) this.flashlight.on = false;
    if (a.get('dynres') === '0' || a.has('frames')) this.engine.dynamicResolution = false;
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
