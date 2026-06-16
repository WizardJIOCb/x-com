import type { Position, Unit, Weapon } from '../types';
import { ALL_MOB_IDS, SOLDIER_TO_HERO, unitModelId } from './ModelCatalog';

let idCounter = 0;

export function resetIdCounter(): void {
  idCounter = 0;
}

function uid(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

function assaultRifle(): Weapon {
  return { name: 'Assault Rifle', damage: 4, range: 8, aimBonus: 0, critChance: 10, ammo: 999, maxAmmo: 999 };
}

function sniperRifle(): Weapon {
  return { name: 'Sniper Rifle', damage: 6, range: 12, aimBonus: 10, critChance: 25, ammo: 999, maxAmmo: 999 };
}

function shotgun(): Weapon {
  return { name: 'Shotgun', damage: 7, range: 4, aimBonus: 15, critChance: 15, ammo: 999, maxAmmo: 999 };
}

function plasmaRifle(): Weapon {
  return { name: 'Plasma Rifle', damage: 5, range: 9, aimBonus: 5, critChance: 10, ammo: 999, maxAmmo: 999 };
}

function thinManRifle(): Weapon {
  return { name: 'Plasma Carbine', damage: 4, range: 8, aimBonus: 10, critChance: 5, ammo: 999, maxAmmo: 999 };
}

function sectoidPistol(): Weapon {
  return { name: 'Plasma Pistol', damage: 3, range: 6, aimBonus: 5, critChance: 5, ammo: 999, maxAmmo: 999 };
}

const SOLDIER_NAMES = ['Bradford', 'Shen', 'Vahlen', 'Zhang'];
const SOLDIER_CLASSES = ['Assault', 'Sniper', 'Support', 'Heavy'];
const ALIEN_TYPES = [
  { name: 'Sectoid', className: 'Sectoid', hp: 4, aim: 65, defense: 0, mobility: 3, weapon: sectoidPistol },
  { name: 'Thin Man', className: 'Thin Man', hp: 5, aim: 75, defense: 10, mobility: 4, weapon: thinManRifle },
  { name: 'Muton', className: 'Muton', hp: 8, aim: 70, defense: 5, mobility: 3, weapon: plasmaRifle },
];

export function createSoldiers(spawns: Position[]): Unit[] {
  const weapons = [assaultRifle, sniperRifle, shotgun, assaultRifle];

  return SOLDIER_NAMES.map((name, i) => {
    const className = SOLDIER_CLASSES[i];
    const heroId = SOLDIER_TO_HERO[className];
    return {
    id: uid('soldier'),
    name,
    team: 'soldier' as const,
    className,
    modelId: heroId ? unitModelId('hero', heroId) : undefined,
    position: spawns[i] ?? { x: 3 + i, y: Math.floor(38 / 2) },
    hp: 6,
    maxHp: 6,
    aim: 75 + (i === 1 ? 15 : 0),
    defense: i === 2 ? 10 : 0,
    mobility: i === 0 ? 5 : 4,
    actionPoints: 2,
    maxActionPoints: 2,
    weapon: weapons[i](),
    isOverwatching: false,
    isAlive: true,
    hasMoved: false,
    hasActed: false,
  };
  });
}

export function createAliens(spawns: Position[]): Unit[] {
  return spawns.map((pos, i) => {
    const type = ALIEN_TYPES[i % ALIEN_TYPES.length];
    const mobId = ALL_MOB_IDS[i % ALL_MOB_IDS.length];
    return {
      id: uid('alien'),
      name: `${type.name} ${i + 1}`,
      team: 'alien' as const,
      className: type.className,
      modelId: unitModelId('mob', mobId),
      position: pos,
      hp: type.hp,
      maxHp: type.hp,
      aim: type.aim,
      defense: type.defense,
      mobility: type.mobility,
      actionPoints: 2,
      maxActionPoints: 2,
      weapon: type.weapon(),
      isOverwatching: false,
      isAlive: true,
      hasMoved: false,
      hasActed: false,
    };
  });
}

export function resetUnitTurn(unit: Unit): void {
  unit.actionPoints = unit.maxActionPoints;
  unit.hasMoved = false;
  unit.hasActed = false;
  unit.isOverwatching = false;
}