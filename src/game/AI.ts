import type { Position, ShotResult, Unit } from '../types';
import { calculateHitChance, getTilesInBlast, resolveShot } from './Combat';
import { GRID_H, GRID_W, Grid } from './Grid';
import {
  buildAlienBrief,
  buildSoldierBrief,
  claimTarget,
  findBestTacticalMove,
  findRallyMove,
  idealFocusPoint,
  pickSpreadTarget,
  unitInCombat,
  type TacticalBrief,
} from './TacticalAI';

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

  const brief = buildSoldierBrief(soldiers, aliens, grid);
  const pos = soldier.position;
  const visible = aliveAliens.filter(a => grid.hasLineOfSight(pos, a.position));
  const inCombat = unitInCombat(soldier, aliveAliens, grid);
  const role = brief.roles.get(soldier.id) ?? 'vanguard';

  // Подмога: бой идёт, а этот солдат далеко и не видит врагов
  if (
    brief.contactActive &&
    !inCombat &&
    soldier.actionPoints >= 1 &&
    !soldier.hasMoved
  ) {
    const rally = findRallyMove(soldier, brief, grid, occupied);
    if (rally) {
      return {
        type: 'move',
        unit: soldier,
        path: rally.path,
        endPos: rally.endPos,
      };
    }
  }

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
        if (chance >= 28) {
          return {
            type: 'shoot',
            unit: soldier,
            target,
            aimPos: { ...target.position },
          };
        }
      }

      if (!soldier.hasMoved) {
        const moveShot = findBestShootTile(soldier, pos, target, grid, occupied, brief);
        if (moveShot && moveShot.hitChance >= 20) {
          return {
            type: 'move',
            unit: soldier,
            path: moveShot.path,
            endPos: moveShot.endPos,
          };
        }

        const advance = findCombatAdvance(soldier, target, brief, grid, occupied);
        if (advance) {
          return {
            type: 'move',
            unit: soldier,
            path: advance.path,
            endPos: advance.endPos,
          };
        }
      }

      if (role === 'sniper' || role === 'anchor' || soldier.className === 'Support') {
        if (dist <= soldier.weapon.range && calculateHitChance(soldier, target, grid) >= 15) {
          return {
            type: 'shoot',
            unit: soldier,
            target,
            aimPos: { ...target.position },
          };
        }
        if (inCombat && soldier.hasMoved) {
          return { type: 'overwatch', unit: soldier };
        }
      } else if (dist <= soldier.weapon.range) {
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
    const focusEnemy =
      visible[0] ??
      (brief.contactActive && brief.contactPoint
        ? aliveAliens.reduce((best, a) =>
            grid.manhattan(brief.contactPoint!, a.position) <
            grid.manhattan(brief.contactPoint!, best.position)
              ? a
              : best
          )
        : aliveAliens.reduce((best, a) =>
            grid.pathDistance(pos, a.position, occupied) < grid.pathDistance(pos, best.position, occupied)
              ? a
              : best
          ));

    const focus = idealFocusPoint(soldier, brief, pos);
    const rallying = brief.contactActive && !inCombat;
    const advance = findBestTacticalMove(soldier, pos, focus, brief, grid, occupied, {
      preferCover: !rallying && (role === 'sniper' || role === 'anchor'),
      preferLos: visible.length > 0,
      losTarget: rallying && brief.contactPoint
        ? brief.contactPoint
        : focusEnemy.position,
      range: soldier.weapon.range,
      minimizeDist: rallying || role === 'vanguard' || role === 'flanker',
      rallying,
    });

    if (advance) {
      return {
        type: 'move',
        unit: soldier,
        path: advance.path,
        endPos: advance.endPos,
      };
    }
  }

  if (!soldier.hasActed && soldier.actionPoints >= 1 && inCombat) {
    return { type: 'overwatch', unit: soldier };
  }

  return { type: 'wait', unit: soldier };
}

function findCombatAdvance(
  soldier: Unit,
  target: Unit,
  brief: TacticalBrief,
  grid: Grid,
  occupied: Set<string>
) {
  const focus = idealFocusPoint(soldier, brief, soldier.position);
  return findBestTacticalMove(soldier, soldier.position, focus, brief, grid, occupied, {
    preferLos: true,
    losTarget: target.position,
    range: soldier.weapon.range,
    minimizeDist: true,
  });
}

export function planAlienTurn(
  aliens: Unit[],
  soldiers: Unit[],
  grid: Grid,
  occupied: Set<string>
): AIAction[] {
  const actions: AIAction[] = [];
  const aliveSoldiers = soldiers.filter(s => s.isAlive);
  if (aliveSoldiers.length === 0) return actions;

  const brief = buildAlienBrief(aliens, soldiers, grid);
  const simPos = new Map<string, Position>();
  const simOccupied = new Set(occupied);
  const targetClaims = new Map<string, number>();

  for (const alien of aliens) {
    if (alien.isAlive) simPos.set(alien.id, { ...alien.position });
  }

  for (const alien of aliens) {
    if (!alien.isAlive) continue;

    const pos = simPos.get(alien.id)!;
    const role = brief.roles.get(alien.id) ?? 'vanguard';
    const inCombat = unitInCombat(alien, aliveSoldiers, grid);
    const visibleSoldiers = aliveSoldiers.filter(s => grid.hasLineOfSight(pos, s.position));

    // Подмога союзникам в бою
    if (brief.contactActive && !inCombat) {
      const rally = findRallyMove(alien, brief, grid, simOccupied);
      if (rally) {
        simOccupied.delete(`${pos.x},${pos.y}`);
        simOccupied.add(`${rally.endPos.x},${rally.endPos.y}`);
        simPos.set(alien.id, rally.endPos);
        actions.push({
          type: 'move',
          unit: alien,
          path: rally.path,
          endPos: rally.endPos,
        });
        continue;
      }
    }

    if (visibleSoldiers.length > 0) {
      const bestTarget = pickSpreadTarget(alien, visibleSoldiers, targetClaims);
      claimTarget(targetClaims, bestTarget.id);
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

      const moveAndShoot = findAlienTacticalMove(
        alien,
        pos,
        bestTarget,
        brief,
        grid,
        simOccupied,
        true,
        false
      );

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
        } else if (role === 'sniper') {
          actions.push({ type: 'overwatch', unit: alien });
        }
        continue;
      }
    }

    const rallying = brief.contactActive && !inCombat;
    const nearest = rallying && brief.contactPoint
      ? aliveSoldiers.reduce((best, s) =>
          grid.manhattan(brief.contactPoint!, s.position) <
          grid.manhattan(brief.contactPoint!, best.position)
            ? s
            : best
        )
      : pickSpreadTarget(alien, aliveSoldiers, targetClaims);
    if (!rallying) claimTarget(targetClaims, nearest.id);

    const moveResult = findAlienTacticalMove(
      alien,
      pos,
      nearest,
      brief,
      grid,
      simOccupied,
      false,
      rallying
    );

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
    } else if (role === 'sniper' && visibleSoldiers.length > 0) {
      actions.push({ type: 'overwatch', unit: alien });
    } else {
      actions.push({ type: 'wait', unit: alien });
    }
  }

  return actions;
}

function findAlienTacticalMove(
  unit: Unit,
  from: Position,
  target: Unit,
  brief: TacticalBrief,
  grid: Grid,
  occupied: Set<string>,
  preferLos: boolean,
  rallying = false
): { path: Position[]; endPos: Position; canShoot: boolean } | null {
  const role = brief.roles.get(unit.id) ?? 'vanguard';
  const focus = idealFocusPoint(unit, brief, from);
  const move = findBestTacticalMove(unit, from, focus, brief, grid, occupied, {
    preferCover: !rallying && role === 'sniper',
    preferLos: preferLos,
    losTarget: rallying && brief.contactPoint ? brief.contactPoint : target.position,
    range: unit.weapon.range,
    minimizeDist: rallying || role === 'vanguard' || role === 'flanker',
    rallying,
  });

  if (!move) return null;

  const canShoot =
    grid.manhattan(move.endPos, target.position) <= unit.weapon.range &&
    grid.hasLineOfSight(move.endPos, target.position);

  return { path: move.path, endPos: move.endPos, canShoot };
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
  occupied: Set<string>,
  brief: TacticalBrief
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
    const path = grid.findPath(from, tile, occupied);
    if (!path || path.length <= 1) continue;

    const cohesion = brief.buddies.get(unit.id)
      ? (Math.abs(tile.x - brief.buddies.get(unit.id)!.position.x) +
          Math.abs(tile.y - brief.buddies.get(unit.id)!.position.y) <= 5
          ? 6
          : 0)
      : 0;
    const score = chance + coverBonus + cohesion - (path.length - 1) * 0.4;

    if (score > bestScore) {
      bestScore = score;
      best = { path, endPos: tile, hitChance: chance };
    }
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