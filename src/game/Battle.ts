import type { ActionMode, CombatLogEntry, GamePhase, Position, Unit } from '../types';
import {
  applyDamage,
  getTilesInBlast,
  resolveRayUnitHits,
  resolveShot,
  traceShotRay,
} from './Combat';
import { Grid } from './Grid';
import { createAliens, createSoldiers, resetIdCounter, resetUnitTurn } from './Units';
import { planAlienTurn, planNextSoldierAction, type AIAction } from './AI';
import type { AnimationManager } from './Animations';

export class Battle {
  grid: Grid;
  soldiers: Unit[];
  aliens: Unit[];
  phase: GamePhase = 'player';
  selectedUnit: Unit | null = null;
  actionMode: ActionMode = null;
  combatLog: CombatLogEntry[] = [];
  turnNumber = 1;
  movePath: Position[] = [];
  hoveredTile: Position | null = null;
  animations: AnimationManager | null = null;
  isAnimating = false;
  autoBattle = false;
  private autoBattleRunning = false;

  onUpdate: (() => void) | null = null;
  onMapChange: ((tiles: Position[]) => void) | null = null;

  constructor() {
    this.grid = new Grid();
    this.soldiers = createSoldiers(this.grid.soldierSpawns);
    this.aliens = createAliens(this.grid.alienSpawns);
    this.log('Процедурная карта сгенерирована. Разрушайте стены и укрытия!', 'info');
    this.log('Миссия: Уничтожьте всех пришельцев!', 'info');
    this.selectFirstAvailableSoldier();
  }

  get allUnits(): Unit[] {
    return [...this.soldiers, ...this.aliens];
  }

  get occupiedTiles(): Set<string> {
    const set = new Set<string>();
    for (const u of this.allUnits) {
      if (u.isAlive) set.add(`${u.position.x},${u.position.y}`);
    }
    return set;
  }

  get aliveSoldiers(): Unit[] {
    return this.soldiers.filter(s => s.isAlive);
  }

  get aliveAliens(): Unit[] {
    return this.aliens.filter(a => a.isAlive);
  }

  get canInteract(): boolean {
    return this.phase === 'player' && !this.isAnimating && !this.autoBattle;
  }

  private canExecutePlayerAction(): boolean {
    return this.phase === 'player' && !this.isAnimating;
  }

  selectFirstAvailableSoldier(): void {
    const available = this.soldiers.find(s => s.isAlive && s.actionPoints > 0);
    this.selectedUnit = available ?? this.soldiers.find(s => s.isAlive) ?? null;
    this.actionMode = null;
    this.movePath = [];
  }

  selectUnit(unit: Unit): void {
    if (unit.team !== 'soldier' || !unit.isAlive) return;
    if (this.autoBattle) {
      this.autoBattle = false;
      this.log('Автобой остановлен — ручное управление.', 'info');
    }
    if (!this.canInteract) return;
    this.selectedUnit = unit;
    this.actionMode = null;
    this.movePath = [];
    this.notify();
  }

  setActionMode(mode: ActionMode): void {
    if (!this.selectedUnit || !this.canInteract) return;
    this.actionMode = mode;
    this.movePath = [];
    this.notify();
  }

  getReachableTiles(): Position[] {
    if (!this.selectedUnit) return [];
    const occupied = this.occupiedTiles;
    occupied.delete(`${this.selectedUnit.position.x},${this.selectedUnit.position.y}`);
    return this.grid.getReachableTiles(
      this.selectedUnit.position,
      this.selectedUnit.mobility,
      occupied
    );
  }

  toggleAutoBattle(): void {
    if (this.phase === 'victory' || this.phase === 'defeat') return;

    this.autoBattle = !this.autoBattle;
    if (this.autoBattle) {
      this.actionMode = null;
      this.movePath = [];
      this.log('Автобой включён — отряд действует самостоятельно.', 'info');
      void this.runAutoBattleLoop();
    } else {
      this.log('Автобой остановлен.', 'info');
    }
    this.notify();
  }

  private async runAutoBattleLoop(): Promise<void> {
    if (this.autoBattleRunning) return;
    this.autoBattleRunning = true;

    try {
      while (this.autoBattle) {
        if (this.phase === 'victory' || this.phase === 'defeat') break;
        if (this.isAnimating) {
          await delay(60);
          continue;
        }

        if (this.phase !== 'player') {
          await delay(60);
          continue;
        }

        const soldier = this.aliveSoldiers.find(s => s.actionPoints > 0);
        if (!soldier) {
          await this.endPlayerTurn();
          await delay(350);
          continue;
        }

        this.selectedUnit = soldier;
        const action = planNextSoldierAction(
          soldier,
          this.aliens,
          this.soldiers,
          this.grid,
          this.occupiedTiles
        );

        if (!action || action.type === 'wait') {
          soldier.actionPoints = 0;
          this.notify();
          continue;
        }

        await this.executeSoldierAIAction(action);
        await delay(280);

        if (this.allSoldiersDone() && this.phase === 'player') {
          await delay(200);
          await this.endPlayerTurn();
          await delay(350);
        }
      }
    } finally {
      this.autoBattleRunning = false;
      if (this.phase === 'victory' || this.phase === 'defeat') {
        this.autoBattle = false;
      }
      this.notify();
    }
  }

  private async executeSoldierAIAction(action: AIAction): Promise<void> {
    this.selectedUnit = action.unit;

    if (action.type === 'move' && action.endPos) {
      await this.tryMove(action.endPos);
    } else if (action.type === 'shoot' && action.aimPos) {
      await this.tryShootAt(action.aimPos);
    } else if (action.type === 'grenade' && action.grenadePos) {
      await this.tryGrenade(action.grenadePos);
    } else if (action.type === 'overwatch') {
      await this.setOverwatch();
    }
  }

  async handleTileClick(pos: Position): Promise<void> {
    if (!this.canInteract || !this.selectedUnit) return;

    if (this.actionMode === 'move') {
      await this.tryMove(pos);
    } else if (this.actionMode === 'shoot') {
      await this.tryShootAt(pos);
    } else if (this.actionMode === 'grenade') {
      await this.tryGrenade(pos);
    } else {
      const unitAtTile = this.soldiers.find(
        s => s.isAlive && s.position.x === pos.x && s.position.y === pos.y
      );
      if (unitAtTile) this.selectUnit(unitAtTile);
    }
  }

  handleTileHover(pos: Position | null): void {
    if (!this.canInteract) return;
    this.hoveredTile = pos;
    if (pos && this.actionMode === 'move' && this.selectedUnit) {
      const occupied = this.occupiedTiles;
      occupied.delete(`${this.selectedUnit.position.x},${this.selectedUnit.position.y}`);
      const path = this.grid.findPath(this.selectedUnit.position, pos, occupied);
      this.movePath = path ?? [];
    } else {
      this.movePath = [];
    }
    // Не вызываем notify — hover обновляется каждый кадр в render loop
  }

  private async tryMove(dest: Position): Promise<void> {
    const unit = this.selectedUnit!;
    const reachable = this.getReachableTiles();
    if (!reachable.some(p => p.x === dest.x && p.y === dest.y)) return;

    const occupied = this.occupiedTiles;
    occupied.delete(`${unit.position.x},${unit.position.y}`);
    const path = this.grid.findPath(unit.position, dest, occupied);
    if (!path || path.length <= 1) return;
    if (unit.actionPoints < 1) return;

    this.isAnimating = true;
    this.actionMode = null;
    this.movePath = [];

    if (this.animations) {
      await this.animations.animateMove(unit, path);
    }

    unit.position = dest;
    unit.actionPoints -= 1;
    unit.hasMoved = true;

    this.log(`${unit.name} перемещается.`, 'info');
    this.isAnimating = false;
    this.checkAutoEndUnit();
    this.notify();
  }

  private async tryShootAt(aimPos: Position): Promise<void> {
    const shooter = this.selectedUnit!;
    if (shooter.actionPoints < 1 || shooter.hasActed) return;

    const ray = traceShotRay(shooter, aimPos, this.grid, this.allUnits);
    if (!ray) return;

    resolveRayUnitHits(shooter, ray.hits, this.grid);

    this.isAnimating = true;
    this.actionMode = null;

    if (this.animations) {
      await this.animations.playShotToTile(shooter, ray.endPosition, ray.hits);
    }

    shooter.actionPoints = 0;
    shooter.hasActed = true;

    const changedTiles: Position[] = [];
    const killedUnits: Unit[] = [];
    let anyEffect = false;

    for (const hit of ray.hits) {
      if (hit.kind === 'unit' && hit.unit && hit.shotResult) {
        anyEffect = true;
        if (hit.shotResult.hit) {
          const killed = applyDamage(hit.unit, hit.shotResult.damage);
          const critText = hit.shotResult.crit ? ' КРИТ!' : '';
          this.log(
            `${shooter.name} попадает в ${hit.unit.name} (${hit.shotResult.hitChance}% → ${hit.shotResult.damage} урона)${critText}`,
            killed ? 'kill' : 'hit'
          );
          if (killed) {
            this.log(`${hit.unit.name} уничтожен!`, 'kill');
            killedUnits.push(hit.unit);
          }
        } else {
          this.log(
            `${shooter.name} промахивается по ${hit.unit.name} (${hit.shotResult.hitChance}%)`,
            'miss'
          );
        }
      } else if (hit.tileDamage > 0) {
        anyEffect = true;
        const dmg = this.grid.damageTile(hit.position.x, hit.position.y, hit.tileDamage);
        if (dmg) {
          changedTiles.push({ x: hit.position.x, y: hit.position.y });
          if (dmg.destroyed) this.log(dmg.label, 'info');
        }
      } else if (hit.kind === 'wall') {
        anyEffect = true;
        this.log(`${shooter.name}: пуля ударилась о стену.`, 'info');
      }
    }

    if (!anyEffect) {
      this.log(`${shooter.name} стреляет в пустую клетку.`, 'miss');
    }

    if (changedTiles.length > 0) this.onMapChange?.(changedTiles);

    if (this.animations) {
      for (const k of killedUnits) {
        await this.animations.playDeath(k.id);
      }
    }

    this.isAnimating = false;
    this.checkVictory();
    this.checkAutoEndUnit();
    this.notify();
  }

  private async tryGrenade(pos: Position): Promise<void> {
    const unit = this.selectedUnit!;
    if (unit.actionPoints < 1 || unit.hasActed) return;

    const dist = this.grid.manhattan(unit.position, pos);
    if (dist > 8) return;

    this.isAnimating = true;
    this.actionMode = null;

    if (this.animations) {
      await this.animations.playGrenade(unit.position, pos);
    }

    unit.actionPoints = 0;
    unit.hasActed = true;

    const blastTiles = getTilesInBlast(pos, 2, this.grid);
    this.log(`${unit.name} бросает гранату!`, 'info');

    const killedUnits: Unit[] = [];
    const changedTiles: Position[] = [];

    for (const tile of blastTiles) {
      const dmg = this.grid.applyExplosionDamage(tile.x, tile.y, 5);
      if (dmg) {
        changedTiles.push({ x: tile.x, y: tile.y });
        if (dmg.label) this.log(dmg.label, 'info');
      }

      const target = this.allUnits.find(
        u => u.isAlive && u.position.x === tile.x && u.position.y === tile.y
      );
      if (target) {
        const killed = applyDamage(target, 5);
        this.log(`${target.name} получает 5 урона от гранаты!`, 'hit');
        if (killed) {
          this.log(`${target.name} уничтожен!`, 'kill');
          killedUnits.push(target);
        }
      }
    }

    if (changedTiles.length > 0) this.onMapChange?.(changedTiles);

    if (this.animations) {
      for (const k of killedUnits) {
        await this.animations.playDeath(k.id);
      }
    }

    this.isAnimating = false;
    this.checkVictory();
    this.checkAutoEndUnit();
    this.notify();
  }

  async setOverwatch(): Promise<void> {
    const unit = this.selectedUnit!;
    if (unit.actionPoints < 1 || unit.hasActed || !this.canExecutePlayerAction()) return;

    this.isAnimating = true;
    unit.isOverwatching = true;
    unit.actionPoints = 0;
    unit.hasActed = true;
    this.actionMode = null;

    if (this.animations) {
      this.animations.playOverwatchActivate(unit.id);
      await delay(400);
    }

    this.log(`${unit.name} на дозоре.`, 'info');
    this.isAnimating = false;
    this.checkAutoEndUnit();
    this.notify();
  }

  private checkAutoEndUnit(): void {
    if (this.selectedUnit && this.selectedUnit.actionPoints <= 0) {
      const next = this.soldiers.find(
        s => s.isAlive && s.actionPoints > 0 && s.id !== this.selectedUnit!.id
      );
      if (next) this.selectedUnit = next;
    }
  }

  allSoldiersDone(): boolean {
    return this.aliveSoldiers.every(s => s.actionPoints <= 0);
  }

  async endPlayerTurn(): Promise<void> {
    if (this.phase !== 'player' || this.isAnimating) return;

    await this.checkOverwatchAnimated('alien');

    this.phase = 'enemy';
    this.selectedUnit = null;
    this.actionMode = null;
    this.log('--- Ход пришельцев ---', 'info');
    this.notify();

    await this.runEnemyTurn();
  }

  private async checkOverwatchAnimated(team: 'soldier' | 'alien'): Promise<void> {
    const watchers = this.allUnits.filter(u => u.isAlive && u.isOverwatching && u.team === team);
    const targets = team === 'soldier' ? this.aliens : this.soldiers;

    for (const watcher of watchers) {
      for (const target of targets) {
        if (!target.isAlive || !target.hasMoved) continue;
        if (!this.grid.hasLineOfSight(watcher.position, target.position)) continue;
        const dist = this.grid.manhattan(watcher.position, target.position);
        if (dist > watcher.weapon.range) continue;

        const result = resolveShot(watcher, target, this.grid, true);
        watcher.isOverwatching = false;
        this.isAnimating = true;

        if (this.animations) {
          await this.animations.playShot(
            watcher, target, result.hit, result.crit, result.damage
          );
        }

        if (result.hit) {
          const killed = applyDamage(target, result.damage);
          this.log(
            `${watcher.name} (дозор) попадает в ${target.name}!`,
            killed ? 'kill' : 'hit'
          );
          if (killed) {
            this.log(`${target.name} уничтожен!`, 'kill');
            if (this.animations) await this.animations.playDeath(target.id);
          }
        } else {
          this.log(`${watcher.name} (дозор) промахивается.`, 'miss');
        }

        this.isAnimating = false;
        this.checkVictory();
        if (this.phase !== 'enemy' && this.phase !== 'player') return;
      }
    }
  }

  private async runEnemyTurn(): Promise<void> {
    const occupied = this.occupiedTiles;
    const actions = planAlienTurn(this.aliens, this.soldiers, this.grid, occupied);

    for (const alien of this.aliens) {
      if (alien.isAlive) resetUnitTurn(alien);
    }

    for (const action of actions) {
      await this.executeAIAction(action);
      await delay(200);
    }

    this.checkVictory();
    if (this.phase === 'enemy') {
      this.startPlayerTurn();
    }
  }

  private async executeAIAction(action: AIAction): Promise<void> {
    if (action.type === 'move' && action.path && action.endPos) {
      this.isAnimating = true;
      action.unit.hasMoved = true;
      action.unit.actionPoints = Math.max(0, action.unit.actionPoints - 1);

      if (this.animations) {
        await this.animations.animateMove(action.unit, action.path);
      }
      action.unit.position = action.endPos;
      this.log(`${action.unit.name} перемещается.`, 'info');
      this.isAnimating = false;
      this.notify();
    } else if (action.type === 'shoot' && action.target && action.shotResult) {
      this.isAnimating = true;
      const r = action.shotResult;

      if (this.animations) {
        await this.animations.playShot(
          action.unit, action.target, r.hit, r.crit, r.damage
        );
      }

      action.unit.hasActed = true;
      action.unit.actionPoints = 0;

      if (r.hit) {
        const killed = applyDamage(action.target, r.damage);
        this.log(
          `${action.unit.name} попадает в ${action.target.name} (${r.hitChance}% → ${r.damage})`,
          killed ? 'kill' : 'hit'
        );
        if (killed) {
          this.log(`${action.target.name} уничтожен!`, 'kill');
          if (this.animations) await this.animations.playDeath(action.target.id);
        }
      } else {
        this.log(
          `${action.unit.name} промахивается по ${action.target.name} (${r.hitChance}%)`,
          'miss'
        );
      }

      this.isAnimating = false;
      this.checkVictory();
      this.notify();
    }
  }

  private startPlayerTurn(): void {
    this.turnNumber++;
    for (const s of this.soldiers) {
      if (s.isAlive) resetUnitTurn(s);
    }
    this.phase = 'player';
    this.log(`--- Ход XCOM (раунд ${this.turnNumber}) ---`, 'info');
    this.selectFirstAvailableSoldier();
    this.notify();
  }

  private checkVictory(): void {
    if (this.aliveAliens.length === 0) {
      this.phase = 'victory';
      this.log('Все пришельцы уничтожены! Миссия выполнена!', 'info');
      this.notify();
    } else if (this.aliveSoldiers.length === 0) {
      this.phase = 'defeat';
      this.log('Отряд XCOM уничтожен. Миссия провалена.', 'info');
      this.notify();
    }
  }

  log(text: string, type: CombatLogEntry['type']): void {
    this.combatLog.unshift({ text, type });
    if (this.combatLog.length > 50) this.combatLog.pop();
  }

  notify(): void {
    this.onUpdate?.();
  }

  restart(): void {
    resetIdCounter();
    this.animations?.clear();
    this.grid = new Grid();
    this.soldiers = createSoldiers(this.grid.soldierSpawns);
    this.aliens = createAliens(this.grid.alienSpawns);
    this.phase = 'player';
    this.turnNumber = 1;
    this.combatLog = [];
    this.isAnimating = false;
    this.autoBattle = false;
    this.autoBattleRunning = false;
    this.log('Процедурная карта сгенерирована. Разрушайте стены и укрытия!', 'info');
    this.log('Миссия: Уничтожьте всех пришельцев!', 'info');
    this.selectFirstAvailableSoldier();
    this.notify();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}