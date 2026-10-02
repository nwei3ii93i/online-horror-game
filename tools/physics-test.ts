// Verifies the heightfield orientation matches TerrainData.heightAt
import { Physics } from '../src/physics/Physics';
import { TerrainData } from '../src/world/TerrainData';
const t = new TerrainData();
const p = new Physics();
await p.init();
p.addTerrain(t);
p.world.step();
let maxErr = 0;
for (const [x, z] of [[0, 0], [100, -50], [-200, 150], [37.3, 81.7], [-123.4, -250.1], [250, 250], [-10.5, 12.25]]) {
  const hit = p.raycast({ x, y: 200, z }, { x: 0, y: -1, z: 0 }, 500);
  const hy = hit ? 200 - hit.toi : NaN;
  const ty = t.heightAt(x, z);
  maxErr = Math.max(maxErr, Math.abs(hy - ty));
  console.log(x, z, 'physics', hy.toFixed(3), 'terrain', ty.toFixed(3));
}
console.log('max error', maxErr.toFixed(4));
