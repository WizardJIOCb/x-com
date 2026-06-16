export type Team = 'soldier' | 'alien';
export type CoverType = 'none' | 'half' | 'full';
export type TileType = 'floor' | 'wall' | 'destructible_wall' | 'destructible';
export type ActionMode = 'move' | 'shoot' | 'overwatch' | 'grenade' | null;
export type GamePhase = 'player' | 'enemy' | 'animating' | 'victory' | 'defeat';

export interface Position {
  x: number;
  y: number;
}

export interface Tile {
  type: TileType;
  cover: CoverType;
  elevation: number;
  hp: number;
  maxHp: number;
  modelId?: string;
  propId?: number;
}

export interface MapProp {
  id: number;
  modelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface Weapon {
  name: string;
  damage: number;
  range: number;
  aimBonus: number;
  critChance: number;
  ammo: number;
  maxAmmo: number;
}

export interface Unit {
  id: string;
  name: string;
  team: Team;
  className: string;
  modelId?: string;
  position: Position;
  hp: number;
  maxHp: number;
  aim: number;
  defense: number;
  mobility: number;
  actionPoints: number;
  maxActionPoints: number;
  weapon: Weapon;
  isOverwatching: boolean;
  isAlive: boolean;
  hasMoved: boolean;
  hasActed: boolean;
}

export interface ShotResult {
  hit: boolean;
  crit: boolean;
  damage: number;
  hitChance: number;
}

export interface ShotRayHit {
  position: Position;
  kind: 'unit' | 'destructible_wall' | 'destructible' | 'wall';
  unit?: Unit;
  shotResult?: ShotResult;
  tileDamage: number;
}

export interface ShotRayResult {
  aim: Position;
  hits: ShotRayHit[];
  endPosition: Position;
  reachedAim: boolean;
}

export interface CombatLogEntry {
  text: string;
  type: 'hit' | 'miss' | 'kill' | 'info';
}

export interface MapGenResult {
  tiles: Tile[][];
  soldierSpawns: Position[];
  alienSpawns: Position[];
  props: MapProp[];
}