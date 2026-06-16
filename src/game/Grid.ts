import type { CoverType, MapProp, Position, Tile } from '../types';
import { generateMap } from './MapGenerator';

export const TILE_SIZE = 48;
export const GRID_W = 50;
export const GRID_H = 38;

export interface DamageResult {
  destroyed: boolean;
  tile: Tile;
  label: string;
}

export class Grid {
  tiles: Tile[][];
  soldierSpawns: Position[];
  alienSpawns: Position[];
  props: MapProp[];
  destroyedPropIds = new Set<number>();

  constructor() {
    const gen = generateMap();
    this.tiles = gen.tiles;
    this.soldierSpawns = gen.soldierSpawns;
    this.alienSpawns = gen.alienSpawns;
    this.props = gen.props;
  }

  getTile(x: number, y: number): Tile | null {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
    return this.tiles[y][x];
  }

  blocksMovement(tile: Tile): boolean {
    return tile.type === 'wall' || tile.type === 'destructible_wall';
  }

  blocksLineOfSight(tile: Tile): boolean {
    return tile.type === 'wall' || (tile.type === 'destructible_wall' && tile.hp > 0);
  }

  isWalkable(x: number, y: number, occupied: Set<string>): boolean {
    const tile = this.getTile(x, y);
    if (!tile) return false;
    if (this.blocksMovement(tile)) return false;
    return !occupied.has(`${x},${y}`);
  }

  isMapBorder(x: number, y: number): boolean {
    return x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
  }

  damageTile(x: number, y: number, damage: number): DamageResult | null {
    const tile = this.getTile(x, y);
    if (!tile) return null;
    if (tile.type !== 'destructible' && tile.type !== 'destructible_wall') return null;

    tile.hp -= damage;
    if (tile.hp <= 0) {
      const wasWall = tile.type === 'destructible_wall';
      const wasCover = tile.type === 'destructible';
      const propId = tile.propId;
      this.tiles[y][x] = { type: 'floor', cover: 'none', elevation: 0, hp: 0, maxHp: 0 };
      if (propId !== undefined) this.destroyedPropIds.add(propId);
      const label = wasWall ? 'Стена разрушена!' : wasCover ? 'Укрытие уничтожено!' : 'Объект разрушен!';
      return { destroyed: true, tile: this.tiles[y][x], label };
    }

    const label =
      tile.type === 'destructible_wall' ? 'Стена повреждена!' : 'Укрытие повреждено!';
    return { destroyed: false, tile, label };
  }

  applyExplosionDamage(x: number, y: number, damage: number): DamageResult | null {
    const tile = this.getTile(x, y);
    if (!tile) return null;

    if (tile.type === 'wall') {
      if (this.isMapBorder(x, y)) return null;
      const propId = tile.propId;
      this.tiles[y][x] = { type: 'floor', cover: 'none', elevation: 0, hp: 0, maxHp: 0 };
      if (propId !== undefined) this.destroyedPropIds.add(propId);
      return { destroyed: true, tile: this.tiles[y][x], label: 'Стена разрушена!' };
    }

    return this.damageTile(x, y, damage);
  }

  isPropActive(propId: number): boolean {
    return !this.destroyedPropIds.has(propId);
  }

  manhattan(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  getNeighbors(pos: Position): Position[] {
    const dirs = [
      { x: 0, y: -1 }, { x: 0, y: 1 },
      { x: -1, y: 0 }, { x: 1, y: 0 },
    ];
    return dirs
      .map(d => ({ x: pos.x + d.x, y: pos.y + d.y }))
      .filter(p => this.getTile(p.x, p.y) !== null);
  }

  findPath(start: Position, goal: Position, occupied: Set<string>): Position[] | null {
    const key = (p: Position) => `${p.x},${p.y}`;
    const open: Position[] = [start];
    const cameFrom = new Map<string, Position>();
    const cost = new Map<string, number>();
    cost.set(key(start), 0);

    while (open.length > 0) {
      open.sort((a, b) => {
        const ca = cost.get(key(a)) ?? Infinity;
        const cb = cost.get(key(b)) ?? Infinity;
        return ca - cb;
      });
      const current = open.shift()!;

      if (current.x === goal.x && current.y === goal.y) {
        const path: Position[] = [];
        let cur: Position | undefined = current;
        while (cur) {
          path.unshift(cur);
          cur = cameFrom.get(key(cur));
        }
        return path;
      }

      for (const neighbor of this.getNeighbors(current)) {
        if (!this.isWalkable(neighbor.x, neighbor.y, occupied) && !(neighbor.x === goal.x && neighbor.y === goal.y)) {
          continue;
        }
        const newCost = (cost.get(key(current)) ?? 0) + 1;
        const nKey = key(neighbor);
        if (newCost < (cost.get(nKey) ?? Infinity)) {
          cost.set(nKey, newCost);
          cameFrom.set(nKey, current);
          if (!open.some(p => p.x === neighbor.x && p.y === neighbor.y)) {
            open.push(neighbor);
          }
        }
      }
    }
    return null;
  }

  getReachableTiles(start: Position, maxDist: number, occupied: Set<string>): Position[] {
    const reachable: Position[] = [];
    const visited = new Set<string>();
    const queue: { pos: Position; dist: number }[] = [{ pos: start, dist: 0 }];
    visited.add(`${start.x},${start.y}`);

    while (queue.length > 0) {
      const { pos, dist } = queue.shift()!;
      if (dist > 0) reachable.push(pos);

      if (dist >= maxDist) continue;

      for (const neighbor of this.getNeighbors(pos)) {
        const nKey = `${neighbor.x},${neighbor.y}`;
        if (visited.has(nKey)) continue;
        if (!this.isWalkable(neighbor.x, neighbor.y, occupied)) continue;
        visited.add(nKey);
        queue.push({ pos: neighbor, dist: dist + 1 });
      }
    }
    return reachable;
  }

  hasLineOfSight(from: Position, to: Position): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps === 0) return true;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = Math.round(from.x + dx * t);
      const cy = Math.round(from.y + dy * t);
      const tile = this.getTile(cx, cy);
      if (tile && this.blocksLineOfSight(tile)) return false;
    }
    return true;
  }

  getLineTiles(from: Position, to: Position): Position[] {
    const tiles: Position[] = [];
    let x0 = from.x;
    let y0 = from.y;
    const x1 = to.x;
    const y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      tiles.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
    return tiles;
  }

  getTilesInRange(center: Position, range: number): Position[] {
    const tiles: Position[] = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (this.manhattan(center, { x, y }) <= range) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  getCoverAt(pos: Position): CoverType {
    const tile = this.getTile(pos.x, pos.y);
    if (!tile) return 'none';
    if (tile.type === 'destructible' && tile.hp <= 0) return 'none';
    if (tile.type === 'floor' || tile.type === 'destructible_wall') return 'none';
    return tile.cover;
  }
}