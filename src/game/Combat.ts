import type { Position, ShotRayHit, ShotRayResult, ShotResult, Unit } from '../types';
import { Grid } from './Grid';

export function calculateHitChance(
  shooter: Unit,
  target: Unit,
  grid: Grid,
  isOverwatch = false,
  skipLosCheck = false
): number {
  let chance = shooter.aim + shooter.weapon.aimBonus;
  chance -= target.defense;

  const distance = grid.manhattan(shooter.position, target.position);
  if (distance <= 1) chance += 20;
  else if (distance <= 3) chance += 10;
  else if (distance <= 6) chance += 0;
  else chance -= (distance - 6) * 4;

  if (distance > shooter.weapon.range) {
    chance -= (distance - shooter.weapon.range) * 5;
  }

  const cover = grid.getCoverAt(target.position);
  if (cover === 'half') chance -= 20;
  if (cover === 'full') chance -= 40;

  if (!skipLosCheck && !grid.hasLineOfSight(shooter.position, target.position)) return 0;

  if (isOverwatch) chance -= 20;
  if (target.hasMoved) chance -= 20;

  return Math.max(1, Math.min(95, chance));
}

export function resolveShot(
  shooter: Unit,
  target: Unit,
  grid: Grid,
  isOverwatch = false,
  skipLosCheck = false
): ShotResult {
  const hitChance = calculateHitChance(shooter, target, grid, isOverwatch, skipLosCheck);
  const roll = Math.random() * 100;
  const hit = roll <= hitChance;

  if (!hit) {
    return { hit: false, crit: false, damage: 0, hitChance };
  }

  const critRoll = Math.random() * 100;
  const crit = critRoll <= shooter.weapon.critChance;
  const damage = crit
    ? Math.round(shooter.weapon.damage * 1.5)
    : shooter.weapon.damage;

  return { hit: true, crit, damage, hitChance };
}

export function traceShotRay(
  shooter: Unit,
  aimPos: Position,
  grid: Grid,
  allUnits: Unit[]
): ShotRayResult | null {
  const dist = grid.manhattan(shooter.position, aimPos);
  if (dist === 0) return null;
  if (!grid.getTile(aimPos.x, aimPos.y)) return null;

  const line = grid.getLineTiles(shooter.position, aimPos).slice(1);
  const hits: ShotRayHit[] = [];
  let endPosition = shooter.position;

  for (const pos of line) {
    const tile = grid.getTile(pos.x, pos.y);
    if (!tile) break;

    endPosition = pos;

    if (tile.type === 'wall') {
      hits.push({ position: { ...pos }, kind: 'wall', tileDamage: 0 });
      return { aim: aimPos, hits, endPosition: pos, reachedAim: false };
    }

    if (tile.type === 'destructible_wall') {
      hits.push({
        position: { ...pos },
        kind: 'destructible_wall',
        tileDamage: shooter.weapon.damage,
      });
      return { aim: aimPos, hits, endPosition: pos, reachedAim: false };
    }

    if (tile.type === 'destructible') {
      hits.push({
        position: { ...pos },
        kind: 'destructible',
        tileDamage: shooter.weapon.damage,
      });
      return { aim: aimPos, hits, endPosition: pos, reachedAim: false };
    }

    const unit = allUnits.find(
      u =>
        u.isAlive &&
        u.id !== shooter.id &&
        u.team !== shooter.team &&
        u.position.x === pos.x &&
        u.position.y === pos.y
    );

    if (unit) {
      hits.push({
        position: { ...pos },
        kind: 'unit',
        unit,
        tileDamage: 0,
      });
      return { aim: aimPos, hits, endPosition: pos, reachedAim: false };
    }

    if (pos.x === aimPos.x && pos.y === aimPos.y) {
      return { aim: aimPos, hits, endPosition: pos, reachedAim: true };
    }
  }

  return { aim: aimPos, hits, endPosition, reachedAim: false };
}

export function resolveRayUnitHits(
  shooter: Unit,
  hits: ShotRayHit[],
  grid: Grid
): void {
  for (const hit of hits) {
    if (hit.kind === 'unit' && hit.unit) {
      hit.shotResult = resolveShot(shooter, hit.unit, grid, false, true);
    }
  }
}

export function applyDamage(target: Unit, damage: number): boolean {
  target.hp -= damage;
  if (target.hp <= 0) {
    target.hp = 0;
    target.isAlive = false;
    return true;
  }
  return false;
}

export function getShootableTargets(
  shooter: Unit,
  enemies: Unit[],
  grid: Grid
): Unit[] {
  return enemies.filter(e => {
    if (!e.isAlive) return false;
    const dist = grid.manhattan(shooter.position, e.position);
    if (dist > shooter.weapon.range) return false;
    return grid.hasLineOfSight(shooter.position, e.position);
  });
}

export interface ShootThroughAnalysis {
  ray: ShotRayResult;
  obstacle: ShotRayHit;
  shotsToBreak: number;
  targetVisibleAfterBreak: boolean;
  targetInRange: boolean;
}

/** Враг за разрушаемым укрытием/стеной — можно прострелить */
export function analyzeShootThrough(
  shooter: Unit,
  target: Unit,
  grid: Grid,
  allUnits: Unit[]
): ShootThroughAnalysis | null {
  const dist = grid.manhattan(shooter.position, target.position);
  if (dist > shooter.weapon.range) return null;
  if (grid.hasLineOfSight(shooter.position, target.position)) return null;

  const ray = traceShotRay(shooter, target.position, grid, allUnits);
  if (!ray) return null;

  const obstacle = ray.hits.find(
    h => h.kind === 'destructible' || h.kind === 'destructible_wall'
  );
  if (!obstacle) return null;

  const tile = grid.getTile(obstacle.position.x, obstacle.position.y);
  if (!tile || tile.hp <= 0) return null;

  const shotsToBreak = Math.ceil(tile.hp / Math.max(1, shooter.weapon.damage));
  const targetInRange = dist <= shooter.weapon.range;

  return {
    ray,
    obstacle,
    shotsToBreak,
    targetVisibleAfterBreak: true,
    targetInRange,
  };
}

export function shouldShootThroughObstacle(
  shooter: Unit,
  target: Unit,
  grid: Grid,
  allies: Unit[],
  enemies: Unit[],
  analysis: ShootThroughAnalysis
): boolean {
  if (!analysis.targetInRange) return false;
  if (analysis.shotsToBreak > 3) return false;

  const aliveAllies = allies.filter(u => u.isAlive).length;
  const aliveEnemies = enemies.filter(u => u.isAlive).length;
  const numericalAdvantage = aliveAllies >= aliveEnemies + 1;

  if (analysis.shotsToBreak === 1) return true;
  if (numericalAdvantage && analysis.shotsToBreak <= 2) return true;
  if (numericalAdvantage && aliveAllies >= aliveEnemies * 1.5 && analysis.shotsToBreak <= 3) {
    return true;
  }

  const hitChance = calculateHitChance(shooter, target, grid, false, true);
  return hitChance >= 35 && analysis.shotsToBreak <= 2;
}

export function getTilesInBlast(center: Position, radius: number, grid?: Grid): Position[] {
  const tiles: Position[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= radius) {
        const pos = { x: center.x + dx, y: center.y + dy };
        if (!grid || grid.getTile(pos.x, pos.y)) tiles.push(pos);
      }
    }
  }
  return tiles;
}