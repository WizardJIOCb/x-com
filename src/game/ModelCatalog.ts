import heroManifest from '../models/Tripo3d/RiggedHeroes/hero_rig_manifest.json';
import mobManifest from '../models/Tripo3d/RiggedModels/monster_rig_manifest.json';

export type ModelCategory = 'building' | 'cover' | 'prop' | 'unit';

export interface ModelEntry {
  id: string;
  url: string;
  category: ModelCategory;
  path: string;
}

const objectFbxUrls = import.meta.glob<string>('../models/Tripo3d/Objects/**/*.fbx', {
  query: '?url',
  import: 'default',
  eager: true,
});

const heroFbxUrls = import.meta.glob<string>('../models/Tripo3d/Heroes/**/*.fbx', {
  query: '?url',
  import: 'default',
  eager: true,
});

const enemyFbxUrls = import.meta.glob<string>('../models/Tripo3d/Models/**/*.fbx', {
  query: '?url',
  import: 'default',
  eager: true,
});

const riggedHeroUrls = import.meta.glob<string>(
  '../models/Tripo3d/RiggedHeroes/**/*animfix.fbx',
  { query: '?url', import: 'default', eager: true }
);

const riggedMobUrls = import.meta.glob<string>(
  '../models/Tripo3d/RiggedModels/**/*animfix.fbx',
  { query: '?url', import: 'default', eager: true }
);

function slugFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const folder = parts.length >= 2 ? parts[parts.length - 2] : 'model';
  return folder
    .replace(/\+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[()]/g, '')
    .replace(/__+/g, '_')
    .replace(/_3d_model.*$/i, '')
    .replace(/^SK_/, '')
    .replace(/_walk_death_animfix$/, '')
    .toLowerCase();
}

function categorizeObject(path: string): ModelCategory {
  const p = path.toLowerCase();
  if (
    p.includes('building') ||
    p.includes('clinic') ||
    p.includes('storefront') ||
    p.includes('facility') ||
    p.includes('gas+station') ||
    p.includes('reactor')
  ) {
    return 'building';
  }
  if (p.includes('barrier') || p.includes('cart')) {
    return 'cover';
  }
  return 'prop';
}

function buildCatalogFromGlob(
  urls: Record<string, string>,
  categoryFn: (path: string) => ModelCategory,
  idPrefix = ''
): ModelEntry[] {
  const used = new Map<string, number>();
  const entries: ModelEntry[] = [];

  for (const [path, url] of Object.entries(urls) as [string, string][]) {
    let id = `${idPrefix}${slugFromPath(path)}`;
    const baseId = id;
    const count = used.get(baseId) ?? 0;
    if (count > 0) id = `${baseId}_v${count + 1}`;
    used.set(baseId, count + 1);

    entries.push({
      id,
      url,
      category: categoryFn(path),
      path,
    });
  }

  return entries;
}

export const OBJECT_MODELS: ModelEntry[] = buildCatalogFromGlob(
  objectFbxUrls,
  categorizeObject,
  'obj_'
);

export const ALL_MODELS: ModelEntry[] = OBJECT_MODELS;

/** Количество FBX в Tripo3d (для экрана загрузки) */
const textureCount =
  Object.keys(import.meta.glob('../models/Tripo3d/Heroes/**/*.{JPEG,jpeg,JPG,jpg}', { eager: true })).length +
  Object.keys(import.meta.glob('../models/Tripo3d/Models/**/*.{JPEG,jpeg,JPG,jpg}', { eager: true })).length +
  Object.keys(import.meta.glob('../models/Tripo3d/Objects/**/*.{JPEG,jpeg,JPG,jpg}', { eager: true })).length +
  Object.keys(import.meta.glob('../models/Tripo3d/RiggedHeroes/**/*.{JPEG,jpeg,JPG,jpg}', { eager: true })).length +
  Object.keys(import.meta.glob('../models/Tripo3d/RiggedModels/**/*.{JPEG,jpeg,JPG,jpg}', { eager: true })).length;

export const TRIPO_MODEL_COUNTS = {
  objects: Object.keys(objectFbxUrls).length,
  heroes: Object.keys(heroFbxUrls).length,
  enemies: Object.keys(enemyFbxUrls).length,
  riggedHeroes: heroManifest.length,
  riggedMobs: mobManifest.length,
  textures: textureCount,
};

export const BUILDING_MODEL_IDS = OBJECT_MODELS.filter(m => m.category === 'building').map(m => m.id);

const ROUND_BUILDING_HINTS = ['reactor', 'tank', 'silo', 'cylinder'];

export function isRoundBuilding(modelId: string): boolean {
  const entry = OBJECT_MODELS.find(m => m.id === modelId);
  if (!entry) return false;
  const p = entry.path.toLowerCase();
  return ROUND_BUILDING_HINTS.some(h => p.includes(h));
}
export const COVER_MODEL_IDS = OBJECT_MODELS.filter(m => m.category === 'cover').map(m => m.id);
export const PROP_MODEL_IDS = OBJECT_MODELS.filter(m => m.category === 'prop').map(m => m.id);

/** Класс солдата → heroId из Tripo3d/Heroes */
export const SOLDIER_TO_HERO: Record<string, string> = {
  Assault: 'raider',
  Sniper: 'scout',
  Support: 'medis',
  Heavy: 'cyber',
};

/** Класс пришельца → mobId (базовый) */
export const ALIEN_TO_MOB: Record<string, string> = {
  Sectoid: 'normal',
  'Thin Man': 'runner',
  Muton: 'brute',
};

/** Все mobId из манифеста — для разнообразия пришельцев */
export const ALL_MOB_IDS = mobManifest.map(m => m.mobId);

/** Все heroId из манифеста */
export const ALL_HERO_IDS = heroManifest.map(h => h.heroId);

function findGlobKey(glob: Record<string, string>, segment: string): string | null {
  return Object.keys(glob).find(k => k.replace(/\\/g, '/').includes(segment)) ?? null;
}

function findGlobUrl(glob: Record<string, string>, segment: string): string | null {
  const key = findGlobKey(glob, segment);
  return key ? glob[key] : null;
}

export function heroRiggedPath(heroId: string): string | null {
  return findGlobKey(riggedHeroUrls, `/RiggedHeroes/${heroId}/`);
}

export function heroStaticPath(heroId: string): string | null {
  return findGlobKey(heroFbxUrls, `/Heroes/${heroId}/`);
}

export function mobRiggedPath(mobId: string): string | null {
  return findGlobKey(riggedMobUrls, `/RiggedModels/${mobId}/`);
}

export function mobStaticPath(mobId: string): string | null {
  const entry = mobManifest.find(m => m.mobId === mobId);
  if (!entry) return null;
  const folder = entry.sourceFolder.replace(/\\/g, '/');
  return findGlobKey(enemyFbxUrls, `/Models/${folder}/`);
}

export function heroRiggedUrl(heroId: string): string | null {
  return findGlobUrl(riggedHeroUrls, `/RiggedHeroes/${heroId}/`);
}

export function heroStaticUrl(heroId: string): string | null {
  return findGlobUrl(heroFbxUrls, `/Heroes/${heroId}/`);
}

export function mobRiggedUrl(mobId: string): string | null {
  return findGlobUrl(riggedMobUrls, `/RiggedModels/${mobId}/`);
}

export function mobStaticUrl(mobId: string): string | null {
  const entry = mobManifest.find(m => m.mobId === mobId);
  if (!entry) return null;
  const folder = entry.sourceFolder.replace(/\\/g, '/');
  return findGlobUrl(enemyFbxUrls, `/Models/${folder}/`);
}

export function unitModelId(kind: 'hero' | 'mob', assetId: string): string {
  return `unit_${kind}_${assetId}`;
}

const DEFAULT_UNIT_FACING_DEG = -90;

/** Коррекция ориентации Tripo-модели: «вперёд» = +Z в координатах боя */
/** Дополнительный масштаб отдельных объектов при нормализации */
export function modelScaleMultiplier(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes('ambulance')) return 2.8;
  if (id.includes('bus')) return 4;
  if (id.includes('clinic') || id.includes('storefront')) return 1.45;
  if (id.includes('gas')) return 1.35;
  if (id.includes('facility') || id.includes('industrial')) return 1.4;
  if (id.includes('building')) return 1.3;
  if (id.includes('reactor') || id.includes('tank') || id.includes('silo')) return 0.7;
  return 1;
}

export function unitFacingOffsetRadians(modelId: string): number {
  if (modelId.startsWith('unit_hero_')) {
    const heroId = modelId.slice('unit_hero_'.length);
    const entry = heroManifest.find(h => h.heroId === heroId);
    const deg = entry?.facingOffset ?? DEFAULT_UNIT_FACING_DEG;
    return (deg * Math.PI) / 180;
  }
  if (modelId.startsWith('unit_mob_')) {
    const mobId = modelId.slice('unit_mob_'.length);
    const entry = mobManifest.find(m => m.mobId === mobId);
    const deg = entry?.facingOffset ?? DEFAULT_UNIT_FACING_DEG;
    return (deg * Math.PI) / 180;
  }
  return 0;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}