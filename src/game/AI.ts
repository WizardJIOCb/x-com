import type { Position, ShotResult, Unit } from '../types';
import { calculateHitChance, getTilesInBlast, resolveShot } from './Combat';
import { GRID_H, GRID_W, Grid } from './Grid';

export type AIActionType = 'move' | 'shoot' | 'wait' | 'overwatch' | 'grenade';

export interface AIAction {
  type: AIActionType;
  unit: Unit;
  target?: Unit;
  aimPos?: Position;
  path?: Position[];
  endPos?: Position;
  grenadePos?: Position;
  shotResult?: ShotResult;
}

export function planNextSoldierAction(
  soldier: Unit,
  aliens: Unit[],
  soldiers: Unit[],
  grid: Grid,
  occupied: Set<string>
): AIAction {
  const aliveAliens = aliens.filter(a => a.isAlive);
  if (aliveAliens.length === 0) return { type: 'wait', unit: soldier };

  const pos = soldier.position;
  const visible = aliveAliens.filter(a => grid.hasLineOfSight(pos, a.position));

  if (!soldier.hasActed && soldier.actionPoints >= 1) {
    if (soldier.className === 'Heavy') {
      const grenadePos = findBestGrenadePos(soldier, aliveAliens, soldiers, grid);
      if (grenadePos) {
        return { type: 'grenade', unit: soldier, grenadePos };
      }
    }

    if (visible.length > 0) {
      const target = pickBestTarget(soldier, visible, grid, pos);
      const dist = grid.manhattan(pos, target.position);

      if (dist <= soldier.weapon.range) {
        const chance = calculateHitChance(soldier, target, grid);
        if (chance >= 30) {
          return {
            type: 'shoot',
            unit: soldier,
            target,
            aimPos: { ...target.position },
          };
        }
      }

      if (!soldier.hasMoved) {
        const moveShot = findBestShootTile(soldier, pos, target, grid, occupied);
        if (moveShot && moveShot.hitChance >= 25) {
          return {
            type: 'move',
            unit: soldier,
            path: moveShot.path,
            endPos: moveShot.endPos,
          };
        }
      }

      if (soldier.className === 'Sniper' || soldier.className === 'Support') {
        return { type: 'overwatch', unit: soldier };
      }

      if (dist <= soldier.weapon.range) {
        return {
          type: 'shoot',
          unit: soldier,
          target,
          aimPos: { ...target.position },
        };
      }
    }
  }

  if (soldier.actionPoints >= 1 && !soldier.hasMoved) {
    const focus = visible[0] ?? aliveAliens.reduce((best, a) =>
      grid.manhattan(pos, a.position) < grid.manhattan(pos, best.position) ? a : best
    );

    const advance = findAdvanceTile(soldier, pos, focus, grid, occupied);
    if (advance) {
      return {
        type: 'move',
        unit: soldier,
        path: advance.path,
        endPos: advance.endPos,
      };
    }

    const closer = tryMoveCloser(soldier, pos, focus, grid, occupied);
    if (closer) {
      return {
        type: 'move',
        unit: soldier,
        path: closer.path,
        endPos: closer.endPos,
      };
    }
  }

  if (!soldier.hasActed && soldier.actionPoints >= 1) {
    return { type: 'overwatch', unit: soldier };
  }

  return { type: 'wait', unit: soldier };
}

export function planAlienTurn(
  aliens: Unit[],
  soldiers: Unit[],
  grid: Grid,
  occupied: Set<string>
): AIAction[] {
  const actions: AIAction[] = [];
  const aliveSoldiers = soldiers.filter(s => s.isAlive);
  const simPos = new Map<string, Position>();
  const simOccupied = new Set(occupied);

  for (const alien of aliens) {
    if (alien.isAlive) {
      simPos.set(alien.id, { ...alien.position });
    }
  }

  for (const alien of aliens) {
    if (!alien.isAlive) continue;

    const pos = simPos.get(alien.id)!;

    const visibleSoldiers = aliveSoldiers.filter(s =>
      grid.hasLineOfSight(pos, s.position)
    );

    if (visibleSoldiers.length > 0) {
      const bestTarget = pickBestTarget(alien, visibleSoldiers, grid, pos);
      const dist = grid.manhattan(pos, bestTarget.position);

      if (dist <= alien.weapon.range) {
        const result = resolveShot(alien, bestTarget, grid);
        actions.push({
          type: 'shoot',
          unit: alien,
          target: bestTarget,
          shotResult: result,
        });
        continue;
      }

      const moveAndShoot = tryMoveCloser(alien, pos, bestTarget, grid, simOccupied);
      if (moveAndShoot) {
        simOccupied.delete(`${pos.x},${pos.y}`);
        simOccupied.add(`${moveAndShoot.endPos.x},${moveAndShoot.endPos.y}`);
        simPos.set(alien.id, moveAndShoot.endPos);

        actions.push({
          type: 'move',
          unit: alien,
          path: moveAndShoot.path,
          endPos: moveAndShoot.endPos,
        });

        if (moveAndShoot.canShoot) {
          const movedAlien = { ...alien, position: moveAndShoot.endPos };
          const result = resolveShot(movedAlien, bestTarget, grid);
          actions.push({
            type: 'shoot',
            unit: alien,
            target: bestTarget,
            shotResult: result,
          });
        }
        continue;
      }
    }

    if (aliveSoldiers.length > 0) {
      const nearest = aliveSoldiers.reduce((best, s) => {
        const d1 = grid.manhattan(pos, best.position);
        const d2 = grid.manhattan(pos, s.position);
        return d2 < d1 ? s : best;
      });

      const moveResult = tryMoveCloser(alien, pos, nearest, grid, simOccupied);
      if (moveResult) {
        simOccupied.delete(`${pos.x},${pos.y}`);
        simOccupied.add(`${moveResult.endPos.x},${moveResult.endPos.y}`);
        simPos.set(alien.id, moveResult.endPos);
        actions.push({
          type: 'move',
          unit: alien,
          path: moveResult.path,
          endPos: moveResult.endPos,
        });
      } else {
        actions.push({ type: 'wait', unit: alien });
      }
    }
  }

  return actions;
}

function findBestGrenadePos(
  unit: Unit,
  aliens: Unit[],
  soldiers: Unit[],
  grid: Grid
): Position | null {
  let best: Position | null = null;
  let bestCount = 0;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const pos = { x, y };
      if (grid.manhattan(unit.position, pos) > 8) continue;
      if (!grid.getTile(x, y)) continue;

      const blast = getTilesInBlast(pos, 2, grid);
      let alienHits = 0;
      let friendlyHits = 0;

      for (const tile of blast) {
        if (soldiers.some(s => s.isAlive && s.position.x === tile.x && s.position.y === tile.y)) {
          friendlyHits++;
        }
        if (aliens.some(a => a.isAlive && a.position.x === tile.x && a.position.y === tile.y)) {
          alienHits++;
        }
      }

      if (friendlyHits > 0 || alienHits < 2) continue;
      if (alienHits > bestCount) {
        bestCount = alienHits;
        best = pos;
      }
    }
  }

  return best;
}

function findBestShootTile(
  unit: Unit,
  from: Position,
  target: Unit,
  grid: Grid,
  occupied: Set<string>
): { path: Position[]; endPos: Position; hitChance: number } | null {
  const reachable = grid.getReachableTiles(from, unit.mobility, occupied);
  let best: { path: Position[]; endPos: Position; hitChance: number } | null = null;
  let bestScore = -1;

  for (const tile of reachable) {
    if (!grid.hasLineOfSight(tile, target.position)) continue;
    const dist = grid.manhattan(tile, target.position);
    if (dist > unit.weapon.range) continue;

    const shooterAt = { ...unit, position: tile };
    const chance = calculateHitChance(shooterAt, target, grid);
    const cover = grid.getCoverAt(tile);
    const coverBonus = cover === 'full' ? 15 : cover === 'half' ? 8 : 0;
    const score = chance + coverBonus;

    if (score > bestScore) {
      const path = grid.findPath(from, tile, occupied);
      if (!path || path.length <= 1) continue;
      bestScore = score;
      best = { path, endPos: tile, hitChance: chance };
    }
  }

  return best;
}

function findAdvanceTile(
  unit: Unit,
  from: Position,
  target: Unit,
  grid: Grid,
  occupied: Set<string>
): { path: Position[]; endPos: Position } | null {
  const reachable = grid.getReachableTiles(from, unit.mobility, occupied);
  const prefersDistance = unit.className === 'Sniper';
  let best: { path: Position[]; endPos: Position } | null = null;
  let bestScore = prefersDistance ? -Infinity : Infinity;

  for (const tile of reachable) {
    const dist = grid.manhattan(tile, target.position);
    const cover = grid.getCoverAt(tile);
    const coverBonus = cover === 'full' ? 3 : cover === 'half' ? 1.5 : 0;
    const losBonus = grid.hasLineOfSight(tile, target.position) ? 2 : 0;
    const score = prefersDistance
      ? dist + coverBonus * 2 + losBonus
      : dist - coverBonus * 2 - losBonus;

    const isBetter = prefersDistance ? score > bestScore : score < bestScore;
    if (!isBetter) continue;

    const path = grid.findPath(from, tile, occupied);
    if (!path || path.length <= 1) continue;
    bestScore = score;
    best = { path, endPos: tile };
  }

  return best;
}

function pickBestTarget(shooter: Unit, targets: Unit[], grid: Grid, pos: Position): Unit {
  const shooterAt = { ...shooter, position: pos };
  return targets.reduce((best, t) => {
    const chanceBest = calculateHitChance(shooterAt, best, grid);
    const chanceT = calculateHitChance(shooterAt, t, grid);
    if (chanceT !== chanceBest) return chanceT > chanceBest ? t : best;
    return t.hp < best.hp ? t : best;
  });
}

function tryMoveCloser(
  unit: Unit,
  from: Position,
  target: Unit,
  grid: Grid,
  occupied: Set<string>
): { path: Position[]; endPos: Position; canShoot: boolean } | null {
  const reachable = grid.getReachableTiles(from, unit.mobility, occupied);
  if (reachable.length === 0) return null;

  let bestTile: Position | null = null;
  let bestDist = Infinity;

  for (const tile of reachable) {
    const dist = grid.manhattan(tile, target.position);
    if (dist < bestDist) {
      bestDist = dist;
      bestTile = tile;
    }
  }

  if (!bestTile) return null;

  const path = grid.findPath(from, bestTile, occupied);
  if (!path || path.length <= 1) return null;

  const canShoot =
    bestDist <= unit.weapon.range &&
    grid.hasLineOfSight(bestTile, target.position);

  return { path, endPos: bestTile, canShoot };
}