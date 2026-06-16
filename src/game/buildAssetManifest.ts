import {
  ALL_HERO_IDS,
  ALL_MOB_IDS,
  ALL_MODELS,
  heroStaticPath,
  heroStaticUrl,
  mobStaticPath,
  mobStaticUrl,
} from './ModelCatalog';
import type { AssetItem } from './LoadProgress';
import { getTexturesForModel } from './ModelTextures';

export function buildAssetManifest(): AssetItem[] {
  const seen = new Set<string>();
  const items: AssetItem[] = [];

  const add = (url: string | null, label: string, kind: AssetItem['kind']) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({ url, label, kind });
  };

  const addTextures = (modelPath: string | null, prefix: string) => {
    if (!modelPath) return;
    const set = getTexturesForModel(modelPath);
    if (set.basecolor) add(set.basecolor, `${prefix} · basecolor`, 'texture');
    if (set.normal) add(set.normal, `${prefix} · normal`, 'texture');
    if (set.roughness) add(set.roughness, `${prefix} · roughness`, 'texture');
    if (set.metallic) add(set.metallic, `${prefix} · metallic`, 'texture');
  };

  for (const entry of ALL_MODELS) {
    add(entry.url, entry.id, 'model');
    addTextures(entry.path, entry.id);
  }

  for (const heroId of ALL_HERO_IDS) {
    add(heroStaticUrl(heroId), `hero:${heroId}`, 'model');
    addTextures(heroStaticPath(heroId), `hero:${heroId}`);
  }

  for (const mobId of ALL_MOB_IDS) {
    add(mobStaticUrl(mobId), `mob:${mobId}`, 'model');
    addTextures(mobStaticPath(mobId), `mob:${mobId}`);
  }

  return items;
}

export async function probeAssetSizes(urls: string[]): Promise<number> {
  const batchSize = 24;
  let total = 0;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const sizes = await Promise.all(
      batch.map(async url => {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          return Number(res.headers.get('content-length')) || 0;
        } catch {
          return 0;
        }
      })
    );
    total += sizes.reduce((a, b) => a + b, 0);
  }

  return total;
}