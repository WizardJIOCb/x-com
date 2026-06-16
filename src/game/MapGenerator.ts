import type { CoverType, MapGenResult, MapProp, Position, Tile } from '../types';
import { GRID_H, GRID_W } from './Grid';
import { BUILDING_MODEL_IDS, COVER_MODEL_IDS, PROP_MODEL_IDS, isRoundBuilding, pickRandom } from './ModelCatalog';

const BUILDING_GAP = 3;
const BUILDING_PLACE_ATTEMPTS = 48;

function floorTile(): Tile {
  return { type: 'floor', cover: 'none', elevation: 0, hp: 0, maxHp: 0 };
}

function wallTile(destructible = false): Tile {
  if (destructible) {
    const hp = 3 + Math.floor(Math.random() * 3);
    return { type: 'destructible_wall', cover: 'full', elevation: 1, hp, maxHp: hp };
  }
  return { type: 'wall', cover: 'full', elevation: 1, hp: 0, maxHp: 0 };
}

function coverTile(cover: CoverType): Tile {
  const hp = cover === 'full' ? 3 : 2;
  return { type: 'destructible', cover, elevation: 0, hp, maxHp: hp };
}

function inBounds(x: number, y: number): boolean {
  return x > 0 && y > 0 && x < GRID_W - 1 && y < GRID_H - 1;
}

function setTile(map: Tile[][], x: number, y: number, tile: Tile): void {
  if (inBounds(x, y)) map[y][x] = tile;
}

function isWalkableTile(tile: Tile): boolean {
  return tile.type === 'floor' || tile.type === 'destructible';
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

function canPlaceRect(map: Tile[][], rect: Rect, placed: Rect[]): boolean {
  for (const other of placed) {
    if (rectsOverlap(rect, other, BUILDING_GAP)) return false;
  }

  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const tx = rect.x + dx;
      const ty = rect.y + dy;
      if (!inBounds(tx, ty)) return false;
      if (map[ty][tx].type !== 'floor') return false;
    }
  }

  return true;
}

function stampRect(
  map: Tile[][],
  x: number,
  y: number,
  w: number,
  h: number,
  destructible: boolean,
  propId: number
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(tx, ty)) continue;
      if (map[ty][tx].type === 'wall') continue;
      const tile = wallTile(destructible);
      tile.propId = propId;
      setTile(map, tx, ty, tile);
    }
  }
}

function carveRect(map: Tile[][], x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(tx, ty)) continue;
      map[ty][tx] = floorTile();
    }
  }
}

function findSpawnTiles(map: Tile[][], zone: { x1: number; y1: number; x2: number; y2: number }, count: number): Position[] {
  const candidates: Position[] = [];
  for (let y = zone.y1; y <= zone.y2; y++) {
    for (let x = zone.x1; x <= zone.x2; x++) {
      if (isWalkableTile(map[y][x])) candidates.push({ x, y });
    }
  }
  shuffle(candidates);
  return candidates.slice(0, count);
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function ensureSpawnReachable(map: Tile[][], zone: { x1: number; y1: number; x2: number; y2: number }): void {
  const cx = Math.floor((zone.x1 + zone.x2) / 2);
  const cy = Math.floor((zone.y1 + zone.y2) / 2);
  carveRect(map, cx - 4, cy - 3, 8, 6);
}

function pickBuildingSize(modelId: string): { w: number; h: number } {
  if (isRoundBuilding(modelId)) {
    return { w: 2 + Math.floor(Math.random() * 2), h: 2 + Math.floor(Math.random() * 2) };
  }

  const path = modelId.toLowerCase();
  if (path.includes('gas') || path.includes('storefront') || path.includes('clinic')) {
    return {
      w: 5 + Math.floor(Math.random() * 2),
      h: 4 + Math.floor(Math.random() * 2),
    };
  }

  if (path.includes('facility') || path.includes('industrial')) {
    return {
      w: 5 + Math.floor(Math.random() * 3),
      h: 4 + Math.floor(Math.random() * 2),
    };
  }

  if (path.includes('building')) {
    return {
      w: 4 + Math.floor(Math.random() * 2),
      h: 3 + Math.floor(Math.random() * 2),
    };
  }

  return {
    w: 3 + Math.floor(Math.random() * 3),
    h: 3 + Math.floor(Math.random() * 2),
  };
}

export function generateMap(): MapGenResult {
  const map: Tile[][] = [];
  const props: MapProp[] = [];
  const placedBuildings: Rect[] = [];
  let nextPropId = 0;

  for (let y = 0; y < GRID_H; y++) {
    map[y] = [];
    for (let x = 0; x < GRID_W; x++) {
      map[y][x] = floorTile();
    }
  }

  // Периметр — неразрушимые стены
  for (let x = 0; x < GRID_W; x++) {
    map[0][x] = wallTile(false);
    map[GRID_H - 1][x] = wallTile(false);
  }
  for (let y = 0; y < GRID_H; y++) {
    map[y][0] = wallTile(false);
    map[y][GRID_W - 1] = wallTile(false);
  }

  const districts = [
    { cx: Math.floor(GRID_W * 0.32), cy: Math.floor(GRID_H * 0.32), spread: 9 },
    { cx: Math.floor(GRID_W * 0.58), cy: Math.floor(GRID_H * 0.48), spread: 10 },
    { cx: Math.floor(GRID_W * 0.72), cy: Math.floor(GRID_H * 0.28), spread: 8 },
    { cx: Math.floor(GRID_W * 0.42), cy: Math.floor(GRID_H * 0.7), spread: 9 },
  ];

  const buildingCount = 14 + Math.floor(Math.random() * 8);
  for (let i = 0; i < buildingCount; i++) {
    if (BUILDING_MODEL_IDS.length === 0) break;

    const modelId = pickRandom(BUILDING_MODEL_IDS);
    const { w: bw, h: bh } = pickBuildingSize(modelId);
    let placed = false;

    for (let attempt = 0; attempt < BUILDING_PLACE_ATTEMPTS; attempt++) {
      const district = districts[Math.floor(Math.random() * districts.length)];
      const bx = district.cx + Math.floor((Math.random() - 0.5) * district.spread * 2) - Math.floor(bw / 2);
      const by = district.cy + Math.floor((Math.random() - 0.5) * district.spread * 2) - Math.floor(bh / 2);
      const rect: Rect = { x: bx, y: by, w: bw, h: bh };

      if (!canPlaceRect(map, rect, placedBuildings)) continue;

      const destructible = Math.random() < 0.72;
      const propId = nextPropId++;

      props.push({
        id: propId,
        modelId,
        x: bx,
        y: by,
        w: bw,
        h: bh,
        rotation: isRoundBuilding(modelId) ? 0 : Math.floor(Math.random() * 4) * (Math.PI / 2),
      });

      stampRect(map, bx, by, bw, bh, destructible, propId);
      placedBuildings.push(rect);

      if (!isRoundBuilding(modelId) && bw >= 5 && bh >= 4 && Math.random() < 0.55) {
        carveRect(map, bx + 1, by + 1, bw - 2, bh - 2);
      }

      placed = true;
      break;
    }

    if (!placed) continue;
  }

  // Разрушенные линии стен / баррикады
  for (let i = 0; i < 12; i++) {
    const horizontal = Math.random() < 0.5;
    const len = 4 + Math.floor(Math.random() * 8);
    const sx = 3 + Math.floor(Math.random() * (GRID_W - len - 6));
    const sy = 3 + Math.floor(Math.random() * (GRID_H - 6));
    for (let j = 0; j < len; j++) {
      const tx = horizontal ? sx + j : sx;
      const ty = horizontal ? sy : sy + j;
      if (inBounds(tx, ty) && map[ty][tx].type === 'floor') {
        const tile = wallTile(true);
        if (COVER_MODEL_IDS.length > 0) {
          tile.modelId = pickRandom(COVER_MODEL_IDS);
        }
        setTile(map, tx, ty, tile);
      }
    }
  }

  // Укрытия (ящики, баррикады)
  const coverCount = Math.floor(GRID_W * GRID_H * 0.04);
  for (let i = 0; i < coverCount; i++) {
    const x = 2 + Math.floor(Math.random() * (GRID_W - 4));
    const y = 2 + Math.floor(Math.random() * (GRID_H - 4));
    if (map[y][x].type !== 'floor') continue;
    const cover: CoverType = Math.random() < 0.45 ? 'full' : 'half';
    const tile = coverTile(cover);
    if (COVER_MODEL_IDS.length > 0) {
      tile.modelId = pickRandom(COVER_MODEL_IDS);
    }
    map[y][x] = tile;
  }

  const vehiclePropIds = PROP_MODEL_IDS.filter(
    id => id.includes('ambulance') || id.includes('bus')
  );

  // Декоративные объекты на полу (скора и автобус — чаще)
  const propCount = Math.floor(GRID_W * GRID_H * 0.02);
  for (let i = 0; i < propCount; i++) {
    const x = 2 + Math.floor(Math.random() * (GRID_W - 4));
    const y = 2 + Math.floor(Math.random() * (GRID_H - 4));
    if (map[y][x].type !== 'floor' || map[y][x].modelId) continue;
    if (PROP_MODEL_IDS.length === 0) continue;

    if (vehiclePropIds.length > 0 && Math.random() < 0.22) {
      map[y][x].modelId = pickRandom(vehiclePropIds);
    } else {
      map[y][x].modelId = pickRandom(PROP_MODEL_IDS);
    }
  }

  // Зоны высадки
  const soldierZone = { x1: 2, y1: Math.floor(GRID_H * 0.3), x2: Math.floor(GRID_W * 0.18), y2: Math.floor(GRID_H * 0.7) };
  const alienZone = { x1: Math.floor(GRID_W * 0.78), y1: Math.floor(GRID_H * 0.2), x2: GRID_W - 3, y2: Math.floor(GRID_H * 0.8) };

  ensureSpawnReachable(map, soldierZone);
  ensureSpawnReachable(map, alienZone);

  // Очистка зон спавна от стен
  for (let y = soldierZone.y1; y <= soldierZone.y2; y++) {
    for (let x = soldierZone.x1; x <= soldierZone.x2; x++) {
      if (map[y][x].type !== 'wall') map[y][x] = floorTile();
    }
  }
  for (let y = alienZone.y1; y <= alienZone.y2; y++) {
    for (let x = alienZone.x1; x <= alienZone.x2; x++) {
      if (map[y][x].type !== 'wall') map[y][x] = floorTile();
    }
  }

  const soldierSpawns = findSpawnTiles(map, soldierZone, 4);
  const alienSpawns = findSpawnTiles(map, alienZone, 8);

  return { tiles: map, soldierSpawns, alienSpawns, props };
}