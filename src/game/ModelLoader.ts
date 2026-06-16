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
  unitFacingOffsetRadians,
  unitModelId,
} from './ModelCatalog';
import { applyPbrTextures } from './ModelTextures';

export interface NormalizedModel {
  group: THREE.Group;
  baseWidth: number;
  baseDepth: number;
  baseHeight: number;
  animations: THREE.AnimationClip[];
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
          const root = await this.loadFbx(loader, entry.url, entry.path);
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
    modelPath: string
  ): Promise<THREE.Group> {
    const resourcePath = url.substring(0, url.lastIndexOf('/') + 1);
    loader.setResourcePath(resourcePath);
    const root = await loader.loadAsync(url);
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

        // Статические FBX — нейтральная поза, без артефактов скининга при повороте/масштабе
        if (job.staticUrl && job.staticPath) {
          try {
            const root = await this.loadFbx(loader, job.staticUrl, job.staticPath);
            this.registerTemplate(job.id, root, 'unit', 0.85);
            return;
          } catch (err) {
            console.warn(`[ModelLoader] Статическая модель ${job.id}:`, err);
          }
        }

        if (job.riggedUrl && job.riggedPath) {
          try {
            const root = await this.loadFbx(loader, job.riggedUrl, job.riggedPath);
            this.registerTemplate(job.id, root, 'unit', 0.85);
            return;
          } catch (err) {
            console.warn(`[ModelLoader] Ригованная модель ${job.id}:`, err);
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

    const size = targetSize ?? this.defaultTargetSize(category);
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
      group.userData.facingOffset = unitFacingOffsetRadians(id);
    }

    this.templates.set(id, {
      group,
      baseWidth: dims.x || 1,
      baseDepth: dims.z || 1,
      baseHeight: dims.y || 1,
      animations: group.animations ?? [],
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

  clone(id: string): THREE.Group | null {
    const template = this.templates.get(id);
    if (!template) return null;
    const clone = this.cloneGroup(template.group);
    this.groundAt(clone, 0);
    return clone;
  }

  cloneScaled(id: string, width: number, depth: number, uniform = false): THREE.Group | null {
    const template = this.templates.get(id);
    if (!template) return null;

    const clone = this.cloneGroup(template.group);
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

  private cloneGroup(source: THREE.Group): THREE.Group {
    let hasSkinned = false;
    source.traverse(child => {
      if (child instanceof THREE.SkinnedMesh) hasSkinned = true;
    });

    const clone = (hasSkinned ? SkeletonUtils.clone(source) : source.clone(true)) as THREE.Group;

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