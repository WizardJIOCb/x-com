import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const savedTextureLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function (_url, onLoad) {
  const tex = new THREE.Texture();
  onLoad?.(tex);
  return tex;
};

const mobManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'src/models/Tripo3d/RiggedModels/monster_rig_manifest.json'), 'utf8')
);

function normalizeStaticModel(object, targetSize = 0.85) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  object.scale.multiplyScalar(targetSize / maxDim);
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  object.position.x -= (box.min.x + box.max.x) / 2;
  object.position.y -= box.min.y;
  object.position.z -= (box.min.z + box.max.z) / 2;
  return object;
}

/** Нативный «вперёд» модели: +Z → 0°, +X → -90°, -Z → 180°, -X → 90° */
function detectNativeForwardDeg(object) {
  const box = new THREE.Box3().setFromObject(object);
  const minY = box.min.y + (box.max.y - box.min.y) * 0.4;
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const v = new THREE.Vector3();

  const mass = { px: 0, nx: 0, pz: 0, nz: 0 };
  let count = 0;

  object.traverse(child => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
    const pos = child.geometry.attributes.position;
    if (!pos) return;
    const mw = child.matrixWorld;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mw);
      if (v.y < minY) continue;
      count++;
      if (v.x > cx) mass.px += v.x - cx;
      else mass.nx += cx - v.x;
      if (v.z > cz) mass.pz += v.z - cz;
      else mass.nz += cz - v.z;
    }
  });

  if (count === 0) return 0;

  const dirs = [
    { deg: 0, score: mass.pz },
    { deg: -90, score: mass.px },
    { deg: 180, score: mass.nz },
    { deg: 90, score: mass.nx },
  ];
  dirs.sort((a, b) => b.score - a.score);
  return dirs[0].deg;
}

function findFbx(folder, baseDir) {
  const dir = path.join(baseDir, folder);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.fbx'));
  return files.length ? path.join(dir, files[0]) : null;
}

async function calibrateMob(entry) {
  const mobDir = path.join(root, 'src/models/Tripo3d/Models');
  const fbxPath = findFbx(entry.sourceFolder, mobDir);
  if (!fbxPath) return null;

  const loader = new FBXLoader();
  const buffer = fs.readFileSync(fbxPath);
  const model = loader.parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    fbxPath
  );
  const group = normalizeStaticModel(model);
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);

  const recommended = detectNativeForwardDeg(group);
  const manifest = entry.facingOffset;
  const match = recommended === manifest ? 'OK' : 'FIX';
  console.log(
    `${entry.mobId.padEnd(22)} h=${size.y.toFixed(2)} manifest=${String(manifest).padStart(4)}°  → ${String(recommended).padStart(4)}°  ${match}`
  );
  return { mobId: entry.mobId, manifest, recommended, height: size.y };
}

async function main() {
  console.log('mobId                  height  manifest  recommended');
  const results = [];
  for (const entry of mobManifest) {
    const r = await calibrateMob(entry);
    if (r) results.push(r);
  }
  const fixes = results.filter(r => r.recommended !== r.manifest);
  console.log(`\n${fixes.length} mobs to update: ${fixes.map(f => f.mobId).join(', ')}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    THREE.TextureLoader.prototype.load = savedTextureLoad;
  });