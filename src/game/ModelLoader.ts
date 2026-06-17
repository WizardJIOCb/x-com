import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { ModelEntry } from './ModelCatalog';
import {
  ALL_HERO_IDS,
  ALL_MOB_IDS,
  ALL_MODELS,
  ALIEN_TO_MOB,
  SOLDIER_TO_HERO,
  heroRiggedPath,
  heroRiggedUrl,
  heroStaticPath,
  heroStaticUrl,
  mobRiggedPath,
  mobRiggedUrl,
  mobStaticPath,
  mobStaticUrl,
  modelScaleMultiplier,
  unitFacingOffsetRadians,
  unitModelId,
} from './ModelCatalog';
import { fetchArrayBuffer } from './fetchAsset';
import { applyPbrTextures } from './ModelTextures';

export interface NormalizedModel {
  group: THREE.Group;
  baseWidth: number;
  baseDepth: number;
  baseHeight: number;
  animations: THREE.AnimationClip[];
}

const IDLE_MODEL_SUFFIX = '__idle';

let fbxTexturePatchDepth = 0;
let savedTextureLoaderLoad: typeof THREE.TextureLoader.prototype.load | null = null;
let fbxParseChain: Promise<unknown> = Promise.resolve();

function noopTextureLoaderLoad(
  this: THREE.TextureLoader,
  _url: string,
  onLoad?: (tex: THREE.Texture) => void
): THREE.Texture {
  const tex = new THREE.Texture();
  onLoad?.(tex);
  return tex;
}

function beginSuppressFbxTextures(): void {
  if (fbxTexturePatchDepth === 0) {
    savedTextureLoaderLoad = THREE.TextureLoader.prototype.load;
    THREE.TextureLoader.prototype.load = noopTextureLoaderLoad as typeof THREE.TextureLoader.prototype.load;
  }
  fbxTexturePatchDepth++;
}

function endSuppressFbxTextures(): void {
  fbxTexturePatchDepth = Math.max(0, fbxTexturePatchDepth - 1);
  if (fbxTexturePatchDepth === 0 && savedTextureLoaderLoad) {
    THREE.TextureLoader.prototype.load = savedTextureLoaderLoad;
    savedTextureLoaderLoad = null;
  }
}

/** FBXLoader создаёт TextureLoader внутри parse() — сериализуем и глушим на время parse */
function loadFbxWithoutEmbeddedTextures(
  loader: FBXLoader,
  url: string,
  label: string
): Promise<THREE.Group> {
  const task = async () => {
    beginSuppressFbxTextures();
    try {
      const buffer = await fetchArrayBuffer(url, label, 'model');
      return loader.parse(buffer, url);
    } finally {
      endSuppressFbxTextures();
    }
  };
  const result = fbxParseChain.then(task, task) as Promise<THREE.Group>;
  fbxParseChain = result.catch(() => {});
  return result;
}

export class ModelLoader {
  private templates = new Map<string, NormalizedModel>();
  private loading: Promise<void> | null = null;
  ready = false;

  async loadAll(extraEntries: ModelEntry[] = []): Promise<void> {
    if (this.ready) return;
    if (this.loading) return this.loading;

    this.loading = this.loadEverything([...ALL_MODELS, ...extraEntries]);
    await this.loading;
    this.ready = true;
  }

  private async loadEverything(entries: ModelEntry[]): Promise<void> {
    const loader = new FBXLoader();
    const seen = new Set<string>();

    await Promise.all(
      entries.map(async entry => {
        if (seen.has(entry.url)) return;
        seen.add(entry.url);
        try {
          const root = await this.loadFbx(loader, entry.url, entry.path, entry.id);
          if (!this.templates.has(entry.id)) {
            this.registerTemplate(entry.id, root, entry.category);
          }
        } catch (err) {
          console.warn(`[ModelLoader] Не удалось загрузить ${entry.id}:`, err);
        }
      })
    );

    await this.loadUnitModels(loader);
  }

  private async loadFbx(
    loader: FBXLoader,
    url: string,
    modelPath: string,
    label: string
  ): Promise<THREE.Group> {
    loader.setResourcePath('');
    const root = await loadFbxWithoutEmbeddedTextures(loader, url, label);
    this.stripEmbeddedFbxTextures(root);
    await applyPbrTextures(root, modelPath);
    return root;
  }

  private async loadUnitModels(loader: FBXLoader): Promise<void> {
    const jobs: {
      id: string;
      staticUrl: string | null;
      staticPath: string | null;
      riggedUrl: string | null;
      riggedPath: string | null;
    }[] = [];

    for (const heroId of ALL_HERO_IDS) {
      jobs.push({
        id: unitModelId('hero', heroId),
        staticUrl: heroStaticUrl(heroId),
        staticPath: heroStaticPath(heroId),
        riggedUrl: heroRiggedUrl(heroId),
        riggedPath: heroRiggedPath(heroId),
      });
    }

    for (const mobId of ALL_MOB_IDS) {
      jobs.push({
        id: unitModelId('mob', mobId),
        staticUrl: mobStaticUrl(mobId),
        staticPath: mobStaticPath(mobId),
        riggedUrl: mobRiggedUrl(mobId),
        riggedPath: mobRiggedPath(mobId),
      });
    }

    await Promise.all(
      jobs.map(async job => {
        if (this.templates.has(job.id)) return;

        const idleId = this.idleModelId(job.id);
        if (job.staticUrl && job.staticPath && !this.templates.has(idleId)) {
          try {
            const idleRoot = await this.loadFbx(loader, job.staticUrl, job.staticPath, `${job.id}:idle`);
            this.registerTemplate(idleId, idleRoot, 'unit', 0.85);
          } catch (err) {
            console.warn(`[ModelLoader] Static idle model ${job.id}:`, err);
          }
        }

        // Ригованные animfix-FBX — walk/death клипы; статика — запасной вариант
        if (job.riggedUrl && job.riggedPath) {
          try {
            const root = await this.loadFbx(loader, job.riggedUrl, job.riggedPath, job.id);
            this.registerTemplate(job.id, root, 'unit', 0.85);
            return;
          } catch (err) {
            console.warn(`[ModelLoader] Ригованная модель ${job.id}:`, err);
          }
        }

        if (job.staticUrl && job.staticPath) {
          try {
            const root = await this.loadFbx(loader, job.staticUrl, job.staticPath, `${job.id}:static`);
            this.registerTemplate(job.id, root, 'unit', 0.85);
            return;
          } catch (err) {
            console.warn(`[ModelLoader] Статическая модель ${job.id}:`, err);
          }
        }

        console.warn(`[ModelLoader] Юнит ${job.id} не загружен`);
      })
    );
  }

  private registerTemplate(
    id: string,
    root: THREE.Group,
    category: ModelEntry['category'],
    targetSize?: number
  ): void {
    this.prepareMeshes(root);
    if (category === 'unit' && this.hasSkinnedMesh(root)) {
      root.animations = this.sanitizeUnitAnimations(root, root.animations ?? []);
    }

    const size =
      (targetSize ?? this.defaultTargetSize(category)) * modelScaleMultiplier(id);
    const group =
      category === 'unit'
        ? this.hasSkinnedMesh(root)
          ? this.wrapAndNormalizeRig(root, size)
          : this.normalizeStaticModel(root, size)
        : this.normalizeStaticModel(root, size);

    const box = new THREE.Box3().setFromObject(group);
    const dims = new THREE.Vector3();
    box.getSize(dims);

    if (category === 'unit') {
      const manifestOffset = unitFacingOffsetRadians(id);
      const useManifest =
        id.startsWith('unit_hero_') ||
        id.startsWith('unit_mob_') ||
        this.hasSkinnedMesh(group);
      const facingOffset = useManifest
        ? manifestOffset
        : this.detectUnitFacingOffset(group);
      group.userData.facingOffset = facingOffset;
    }

    this.templates.set(id, {
      group,
      baseWidth: dims.x || 1,
      baseDepth: dims.z || 1,
      baseHeight: dims.y || 1,
      animations: group.animations ?? [],
    });
  }

  private sanitizeUnitAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
    const boneNames = new Set<string>();
    root.traverse(child => {
      if (child instanceof THREE.Bone) boneNames.add(child.name);
    });

    return clips.map(clip => {
      const tracks = clip.tracks.filter(track => {
        if (!track.name.endsWith('.quaternion')) return false;
        const targetName = track.name.slice(0, track.name.indexOf('.'));
        return boneNames.has(targetName);
      });
      const clean = new THREE.AnimationClip(clip.name, clip.duration, tracks);
      clean.optimize();
      return clean;
    });
  }

  private defaultTargetSize(category: ModelEntry['category']): number {
    switch (category) {
      case 'building':
        return 2.8;
      case 'cover':
        return 0.75;
      case 'unit':
        return 0.85;
      default:
        return 0.9;
    }
  }

  private stripEmbeddedFbxTextures(object: THREE.Object3D): void {
    const mapSlots = [
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'emissiveMap',
      'bumpMap',
      'specularMap',
      'alphaMap',
      'lightMap',
      'displacementMap',
    ] as const;

    object.traverse(child => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!(material instanceof THREE.Material)) continue;
        const mats = material as THREE.Material & Partial<Record<(typeof mapSlots)[number], THREE.Texture | null>>;
        for (const slot of mapSlots) {
          if (slot in mats) mats[slot] = null;
        }
        material.needsUpdate = true;
      }
    });
  }

  private prepareMeshes(object: THREE.Object3D): void {
    object.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private fixSkinnedMeshes(object: THREE.Object3D): void {
    object.traverse(child => {
      if (child instanceof THREE.SkinnedMesh) {
        child.normalizeSkinWeights();
        child.frustumCulled = false;
        child.updateMatrixWorld(true);
        child.skeleton?.update();
      }
    });
    object.updateMatrixWorld(true);
  }

  /** Поворот ригованного юнита через корневую кость — не ломает bindMatrix */
  setRigFacing(object: THREE.Object3D, angleY: number): void {
    object.traverse(child => {
      if (!(child instanceof THREE.SkinnedMesh) || !child.skeleton) return;

      const rootBone = this.findSkeletonRoot(child.skeleton);
      if (!rootBone) return;

      if (!rootBone.userData.baseRotation) {
        rootBone.userData.baseRotation = rootBone.rotation.clone();
      }

      const base = rootBone.userData.baseRotation as THREE.Euler;
      rootBone.rotation.set(base.x, base.y + angleY, base.z);
      child.skeleton.update();
    });
  }

  private findSkeletonRoot(skeleton: THREE.Skeleton): THREE.Bone | null {
    for (const bone of skeleton.bones) {
      if (!(bone.parent instanceof THREE.Bone)) return bone;
    }
    return skeleton.bones[0] ?? null;
  }

  hasSkinnedMesh(object: THREE.Object3D): boolean {
    let found = false;
    object.traverse(child => {
      if (child instanceof THREE.SkinnedMesh) found = true;
    });
    return found;
  }

  /**
   * Подбирает Y-поворот, чтобы «лицо» модели смотрело в +Z (как aimAngle при движении вперёд).
   * Перебирает 0/±90/180° и выбирает вариант с максимальным выступом верхней части в +Z.
   */
  private detectUnitFacingOffset(object: THREE.Object3D): number {
    const candidates = [0, -Math.PI / 2, Math.PI / 2, Math.PI];
    const savedY = object.rotation.y;
    const box = new THREE.Box3().setFromObject(object);
    const minY = box.min.y + (box.max.y - box.min.y) * 0.35;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    const v = new THREE.Vector3();

    let best = 0;
    let bestScore = -Infinity;

    for (const angle of candidates) {
      object.rotation.y = angle;
      object.updateMatrixWorld(true);

      let forwardMass = 0;
      let count = 0;
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
        const pos = child.geometry.attributes.position;
        if (!pos) return;
        const mw = child.matrixWorld;
        for (let i = 0; i < pos.count; i += 2) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mw);
          if (v.y < minY) continue;
          if (v.z > centerZ) {
            forwardMass += v.z - centerZ;
            count++;
          }
        }
      });

      const score = count > 0 ? forwardMass / count : 0;
      if (score > bestScore) {
        bestScore = score;
        best = angle;
      }
    }

    object.rotation.y = savedY;
    object.updateMatrixWorld(true);
    return best;
  }

  private normalizeStaticModel(object: THREE.Object3D, targetSize: number): THREE.Group {
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

    return object as THREE.Group;
  }

  /** Масштаб/позиция на обёртке — скелет внутри не деформируется */
  private wrapAndNormalizeRig(root: THREE.Group, targetSize: number): THREE.Group {
    const box = new THREE.Box3().setFromObject(root);
    const dims = new THREE.Vector3();
    box.getSize(dims);
    const maxDim = Math.max(dims.x, dims.y, dims.z, 0.001);
    const scale = targetSize / maxDim;

    const wrapper = new THREE.Group();
    const animations = root.animations ?? [];
    wrapper.add(root);
    wrapper.scale.setScalar(scale);

    wrapper.updateMatrixWorld(true);
    box.setFromObject(wrapper);
    wrapper.position.x -= (box.min.x + box.max.x) / 2;
    wrapper.position.y -= box.min.y;
    wrapper.position.z -= (box.min.z + box.max.z) / 2;
    wrapper.animations = animations;
    this.fixSkinnedMeshes(wrapper);
    return wrapper;
  }

  /** Выставляет нижнюю точку bbox модели на targetY относительно родителя */
  groundAt(object: THREE.Object3D, targetY = 0): void {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    object.position.y += targetY - box.min.y;
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  getUnitModelId(unit: { team: string; className: string; modelId?: string }): string | null {
    if (unit.modelId && this.has(unit.modelId)) return unit.modelId;

    if (unit.team === 'soldier') {
      const heroId = SOLDIER_TO_HERO[unit.className];
      if (heroId) {
        const id = unitModelId('hero', heroId);
        if (this.has(id)) return id;
      }
    } else {
      const mobId = ALIEN_TO_MOB[unit.className];
      if (mobId) {
        const id = unitModelId('mob', mobId);
        if (this.has(id)) return id;
      }
    }

    return null;
  }

  idleModelId(modelId: string): string {
    return `${modelId}${IDLE_MODEL_SUFFIX}`;
  }

  getUnitIdleModelId(unit: { team: string; className: string; modelId?: string }): string | null {
    const modelId = this.getUnitModelId(unit);
    if (!modelId) return null;

    const idleId = this.idleModelId(modelId);
    return this.has(idleId) ? idleId : null;
  }

  getAnimations(id: string): THREE.AnimationClip[] {
    return this.templates.get(id)?.animations ?? [];
  }

  clone(id: string): THREE.Group | null {
    const template = this.templates.get(id);
    if (!template) return null;
    const clone = this.cloneGroup(template.group, template.animations);
    this.groundAt(clone, 0);
    return clone;
  }

  cloneScaled(id: string, width: number, depth: number, uniform = false): THREE.Group | null {
    const template = this.templates.get(id);
    if (!template) return null;

    const clone = this.cloneGroup(template.group, template.animations);
    if (uniform) {
      const target = Math.max(width, depth);
      const base = Math.max(template.baseWidth, template.baseDepth, 0.001);
      const scale = target / base;
      clone.scale.x *= scale;
      clone.scale.z *= scale;
    } else {
      const sx = width / template.baseWidth;
      const sz = depth / template.baseDepth;
      clone.scale.x *= sx;
      clone.scale.z *= sz;
    }
    this.groundAt(clone, 0);
    return clone;
  }

  private cloneGroup(source: THREE.Group, animations: THREE.AnimationClip[] = []): THREE.Group {
    let hasSkinned = false;
    source.traverse(child => {
      if (child instanceof THREE.SkinnedMesh) hasSkinned = true;
    });

    const clone = (hasSkinned ? SkeletonUtils.clone(source) : source.clone(true)) as THREE.Group;
    if (animations.length > 0) {
      clone.animations = animations;
    }

    clone.traverse(child => {
      if (child instanceof THREE.Mesh && !(child instanceof THREE.SkinnedMesh)) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => m.clone());
        } else if (child.material) {
          child.material = child.material.clone();
        }
      }
    });

    if (hasSkinned) {
      clone.userData.isRigged = true;
    }
    if (source.userData.facingOffset != null) {
      clone.userData.facingOffset = source.userData.facingOffset;
    }

    return clone;
  }

  getFacingOffset(modelId: string): number {
    const template = this.templates.get(modelId);
    return (template?.group.userData.facingOffset as number | undefined) ?? 0;
  }

  get loadedCount(): number {
    return this.templates.size;
  }
}

export const modelLoader = new ModelLoader();
