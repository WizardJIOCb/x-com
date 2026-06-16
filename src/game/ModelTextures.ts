import * as THREE from 'three';
import { loadProgress } from './LoadProgress';

export interface PbrTextureSet {
  basecolor?: string;
  normal?: string;
  roughness?: string;
  metallic?: string;
}

const heroTextureUrls = import.meta.glob<string>(
  '../models/Tripo3d/Heroes/**/*.{JPEG,jpeg,JPG,jpg}',
  { query: '?url', import: 'default', eager: true }
);
const mobTextureUrls = import.meta.glob<string>(
  '../models/Tripo3d/Models/**/*.{JPEG,jpeg,JPG,jpg}',
  { query: '?url', import: 'default', eager: true }
);
const objectTextureUrls = import.meta.glob<string>(
  '../models/Tripo3d/Objects/**/*.{JPEG,jpeg,JPG,jpg}',
  { query: '?url', import: 'default', eager: true }
);
const riggedHeroTextureUrls = import.meta.glob<string>(
  '../models/Tripo3d/RiggedHeroes/**/*.{JPEG,jpeg,JPG,jpg}',
  { query: '?url', import: 'default', eager: true }
);
const riggedMobTextureUrls = import.meta.glob<string>(
  '../models/Tripo3d/RiggedModels/**/*.{JPEG,jpeg,JPG,jpg}',
  { query: '?url', import: 'default', eager: true }
);

const textureUrls: Record<string, string> = {
  ...heroTextureUrls,
  ...mobTextureUrls,
  ...objectTextureUrls,
  ...riggedHeroTextureUrls,
  ...riggedMobTextureUrls,
};

const textureCache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

function normPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function modelDirFromPath(modelPath: string): string {
  const p = normPath(modelPath);
  return p.slice(0, p.lastIndexOf('/'));
}

/** Собирает PBR-текстуры из папки модели и её .fbm-подпапок */
export function getTexturesForModel(modelPath: string): PbrTextureSet {
  const dir = modelDirFromPath(modelPath);
  const result: PbrTextureSet = {};

  for (const [path, url] of Object.entries(textureUrls) as [string, string][]) {
    const p = normPath(path);
    if (!p.startsWith(dir + '/')) continue;

    const lower = p.toLowerCase();
    if (lower.includes('basecolor')) result.basecolor = url;
    else if (lower.includes('normal')) result.normal = url;
    else if (lower.includes('roughness')) result.roughness = url;
    else if (lower.includes('metallic')) result.metallic = url;
  }

  return result;
}

function textureLabel(url: string): string {
  const name = url.split('/').pop() ?? url;
  return name.replace(/\.(jpe?g|png|webp)$/i, '');
}

async function loadCached(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture> {
  const cached = textureCache.get(url);
  if (cached) return cached;

  loadProgress.startFile(url, textureLabel(url), 'texture');
  const tex = await loader.loadAsync(url);
  tex.colorSpace = colorSpace;
  tex.flipY = colorSpace === THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  textureCache.set(url, tex);
  loadProgress.completeFile(url);
  return tex;
}

export async function applyPbrTextures(
  object: THREE.Object3D,
  modelPath: string
): Promise<void> {
  const set = getTexturesForModel(modelPath);
  if (!set.basecolor && !set.normal && !set.roughness && !set.metallic) return;

  const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
    set.basecolor ? loadCached(set.basecolor, THREE.SRGBColorSpace) : null,
    set.normal ? loadCached(set.normal, THREE.LinearSRGBColorSpace) : null,
    set.roughness ? loadCached(set.roughness, THREE.LinearSRGBColorSpace) : null,
    set.metallic ? loadCached(set.metallic, THREE.LinearSRGBColorSpace) : null,
  ]);

  object.traverse(child => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      let std: THREE.MeshStandardMaterial;
      if (material instanceof THREE.MeshStandardMaterial) {
        std = material;
      } else if (material instanceof THREE.MeshPhongMaterial) {
        std = new THREE.MeshStandardMaterial({
          color: material.color,
          map: material.map,
          transparent: material.transparent,
          opacity: material.opacity,
        });
      } else {
        std = new THREE.MeshStandardMaterial({ color: 0xcccccc });
      }

      if (map) {
        std.map = map;
        std.color.setHex(0xffffff);
      }
      if (normalMap) {
        std.normalMap = normalMap;
        std.normalScale.set(1, 1);
      }
      if (roughnessMap) std.roughnessMap = roughnessMap;
      if (metalnessMap) std.metalnessMap = metalnessMap;
      if (map || roughnessMap || metalnessMap) {
        std.roughness = 0.85;
        std.metalness = 0.15;
      }
      std.needsUpdate = true;

      if (material !== std) {
        if (Array.isArray(child.material)) {
          const idx = materials.indexOf(material);
          (child.material as THREE.Material[])[idx] = std;
        } else {
          child.material = std;
        }
      }
    }
  });
}

export function disposeTextureCache(): void {
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
}