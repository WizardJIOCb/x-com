import type { Position, Unit } from '../types';
import type { Grid } from './Grid';

export type SquadRole = 'vanguard' | 'flanker' | 'sniper' | 'anchor';

export interface TacticalBrief {
  enemyCentroid: Position;
  friendlyCentroid: Position;
  /** Место столкновения — середина между теми, кто уже видит противника */
  contactPoint: Position | null;
  contactActive: boolean;
  roles: Map<string, SquadRole>;
  buddies: Map<string, Unit | null>;
  flankSign: Map<string, number>;
}

export interface MoveCandidate {
  path: Position[];
  endPos: Position;
  score: number;
}

const posKey = (p: Position) => `${p.x},${p.y}`;

export function centroid(units: Unit[]): Position {
  if (units.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const u of units) {
    sx += u.position.x;
    sy += u.position.y;
  }
  return {
    x: Math.round(sx / units.length),
    y: Math.round(sy / units.length),
  };
}

function roleForSoldier(unit: Unit, index: number): SquadRole {
  switch (unit.className) {
    case 'Sniper':
      return 'sniper';
    case 'Support':
      return 'anchor';
    case 'Heavy':
      return 'vanguard';
    default:
      return index % 2 === 0 ? 'flanker' : 'vanguard';
  }
}

function roleForAlien(unit: Unit, index: number): SquadRole {
  switch (unit.className) {
    case 'Sectoid':
      return 'sniper';
    case 'Thin Man':
      return index % 2 === 0 ? 'flanker' : 'flanker';
    case 'Muton':
      return index % 2 === 0 ? 'vanguard' : 'anchor';
    default:
      return index % 2 === 0 ? 'flanker' : 'vanguard';
  }
}

function computeContactPoint(
  friendlies: Unit[],
  enemies: Unit[],
  grid: Grid
): Position | null {
  let sx = 0;
  let sy = 0;
  let count = 0;

  for (const f of friendlies) {
    for (const e of enemies) {
      if (!grid.hasLineOfSight(f.position, e.position)) continue;
      sx += (f.position.x + e.position.x) * 0.5;
      sy += (f.position.y + e.position.y) * 0.5;
      count++;
    }
  }

  if (count === 0) return null;
  return { x: Math.round(sx / count), y: Math.round(sy / count) };
}

export function buildSoldierBrief(soldiers: Unit[], aliens: Unit[], grid: Grid): TacticalBrief {
  const aliveSoldiers = soldiers.filter(s => s.isAlive);
  const aliveAliens = aliens.filter(a => a.isAlive);
  const sorted = [...aliveSoldiers].sort((a, b) => a.id.localeCompare(b.id));
  const contactPoint = computeContactPoint(aliveSoldiers, aliveAliens, grid);

  const roles = new Map<string, SquadRole>();
  const buddies = new Map<string, Unit | null>();
  const flankSign = new Map<string, number>();

  sorted.forEach((s, i) => {
    roles.set(s.id, roleForSoldier(s, i));
    const buddy = i % 2 === 0 ? sorted[i + 1] ?? null : sorted[i - 1] ?? null;
    buddies.set(s.id, buddy);
    flankSign.set(s.id, i % 2 === 0 ? -1 : 1);
  });

  return {
    enemyCentroid: centroid(aliveAliens),
    friendlyCentroid: centroid(aliveSoldiers),
    contactPoint,
    contactActive: contactPoint !== null,
    roles,
    buddies,
    flankSign,
  };
}

export function buildAlienBrief(aliens: Unit[], soldiers: Unit[], grid: Grid): TacticalBrief {
  const aliveAliens = aliens.filter(a => a.isAlive);
  const aliveSoldiers = soldiers.filter(s => s.isAlive);
  const sorted = [...aliveAliens].sort((a, b) => a.id.localeCompare(b.id));
  const contactPoint = computeContactPoint(aliveAliens, aliveSoldiers, grid);

  const roles = new Map<string, SquadRole>();
  const buddies = new Map<string, Unit | null>();
  const flankSign = new Map<string, number>();

  sorted.forEach((a, i) => {
    roles.set(a.id, roleForAlien(a, i));
    const buddy = i % 2 === 0 ? sorted[i + 1] ?? null : sorted[i - 1] ?? null;
    buddies.set(a.id, buddy);
    flankSign.set(a.id, i % 2 === 0 ? -1 : 1);
  });

  return {
    enemyCentroid: centroid(aliveSoldiers),
    friendlyCentroid: centroid(aliveAliens),
    contactPoint,
    contactActive: contactPoint !== null,
    roles,
    buddies,
    flankSign,
  };
}

function approachPoint(from: Position, target: Position, stopDist: number): Position {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const scale = Math.max(0, dist - stopDist) / dist;
  return {
    x: Math.round(from.x + dx * scale),
    y: Math.round(from.y + dy * scale),
  };
}

function flankPoint(
  from: Position,
  target: Position,
  sign: number,
  offset: number
): Position {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  return {
    x: Math.round(target.x + nx * offset * sign),
    y: Math.round(target.y + ny * offset * sign),
  };
}

export function idealFocusPoint(
  unit: Unit,
  brief: TacticalBrief,
  from: Position
): Position {
  const role = brief.roles.get(unit.id) ?? 'vanguard';
  const sign = brief.flankSign.get(unit.id) ?? 1;
  const hotspot = brief.contactActive && brief.contactPoint
    ? brief.contactPoint
    : brief.enemyCentroid;

  switch (role) {
    case 'sniper':
      return approachPoint(from, hotspot, brief.contactActive ? 7 : 9);
    case 'anchor':
      return brief.contactActive && brief.contactPoint
        ? approachPoint(from, brief.contactPoint, 5)
        : approachPoint(brief.friendlyCentroid, hotspot, 6);
    case 'flanker':
      return brief.contactActive && brief.contactPoint
        ? flankPoint(from, brief.contactPoint, sign, 4)
        : flankPoint(from, hotspot, sign, 5);
    case 'vanguard':
    default:
      return approachPoint(from, hotspot, brief.contactActive ? 1 : 2);
  }
}

function buddyDistance(tile: Position, buddy: Unit | null): number {
  if (!buddy) return 0;
  return Math.abs(tile.x - buddy.position.x) + Math.abs(tile.y - buddy.position.y);
}

function cohesionScore(dist: number): number {
  if (dist >= 2 && dist <= 4) return 14;
  if (dist === 1 || dist === 5) return 6;
  if (dist > 7) return -18;
  if (dist === 0) return -8;
  return 0;
}

export function scoreMoveTile(
  unit: Unit,
  from: Position,
  tile: Position,
  focus: Position,
  brief: TacticalBrief,
  grid: Grid,
  occupied: Set<string>,
  opts: {
    preferCover?: boolean;
    preferLos?: boolean;
    losTarget?: Position;
    range?: number;
    minimizeDist?: boolean;
  } = {}
): number {
  const path = grid.findPath(from, tile, occupied);
  if (!path || path.length <= 1) return -Infinity;

  const role = brief.roles.get(unit.id) ?? 'vanguard';
  const pathSteps = path.length - 1;
  const distToFocus = grid.manhattan(tile, focus);
  const cover = grid.getCoverAt(tile);
  const coverScore =
    cover === 'full' ? 12 : cover === 'half' ? 6 : 0;

  let score = 0;

  if (opts.minimizeDist) {
    score -= distToFocus * 4;
  } else if (role === 'sniper') {
    const ideal = 9;
    score -= Math.abs(distToFocus - ideal) * 3;
    score += coverScore * 1.4;
  } else if (role === 'anchor') {
    score -= Math.abs(distToFocus - 6) * 2.5;
    score += coverScore;
  } else if (role === 'flanker') {
    score -= distToFocus * 2.2;
    score += coverScore * 0.8;
  } else {
    score -= distToFocus * 3.5;
    score += coverScore * 0.5;
  }

  if (opts.preferCover) score += coverScore;
  if (opts.preferLos && opts.losTarget) {
    if (grid.hasLineOfSight(tile, opts.losTarget)) score += 16;
    else score -= 6;
  }
  if (opts.range !== undefined && opts.losTarget) {
    const shotDist = grid.manhattan(tile, opts.losTarget);
    if (shotDist <= opts.range) score += 10;
    else score -= (shotDist - opts.range) * 2;
  }

  score += cohesionScore(buddyDistance(tile, brief.buddies.get(unit.id) ?? null));

  if (brief.contactActive && brief.contactPoint) {
    const pathHere = grid.pathDistance(tile, brief.contactPoint, occupied);
    const pathFrom = grid.pathDistance(from, brief.contactPoint, occupied);
    if (pathHere < pathFrom) score += 40;
    else if (pathHere > pathFrom) score -= 35;
    score -= pathHere * 1.8;
  }

  score -= pathSteps * 0.35;
  score -= occupied.has(posKey(tile)) ? 500 : 0;

  return score;
}

export function findBestTacticalMove(
  unit: Unit,
  from: Position,
  focus: Position,
  brief: TacticalBrief,
  grid: Grid,
  occupied: Set<string>,
  opts: {
    preferCover?: boolean;
    preferLos?: boolean;
    losTarget?: Position;
    range?: number;
    minimizeDist?: boolean;
  } = {}
): MoveCandidate | null {
  const reachable = grid.getReachableTiles(from, unit.mobility, occupied);
  let best: MoveCandidate | null = null;

  for (const tile of reachable) {
    const score = scoreMoveTile(unit, from, tile, focus, brief, grid, occupied, opts);
    if (score === -Infinity) continue;
    const path = grid.findPath(from, tile, occupied);
    if (!path || path.length <= 1) continue;

    if (!best || score > best.score) {
      best = { path, endPos: tile, score };
    }
  }

  return best;
}

export function pickSpreadTarget(
  unit: Unit,
  targets: Unit[],
  claimed: Map<string, number>
): Unit {
  return targets.reduce((best, t) => {
    const claimBest = claimed.get(best.id) ?? 0;
    const claimT = claimed.get(t.id) ?? 0;
    if (claimT !== claimBest) return claimT < claimBest ? t : best;
    const dBest = Math.abs(unit.position.x - best.position.x) + Math.abs(unit.position.y - best.position.y);
    const dT = Math.abs(unit.position.x - t.position.x) + Math.abs(unit.position.y - t.position.y);
    return dT < dBest ? t : best;
  });
}

export function claimTarget(claimed: Map<string, number>, targetId: string): void {
  claimed.set(targetId, (claimed.get(targetId) ?? 0) + 1);
}