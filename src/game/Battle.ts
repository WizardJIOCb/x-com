import type { ActionMode, CombatLogEntry, GamePhase, Position, TurnMode, Unit } from '../types';
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
  turnMode: TurnMode = 'simultaneous';
  selectedUnit: Unit | null = null;
  actionMode: ActionMode = null;
  combatLog: CombatLogEntry[] = [];
  turnNumber = 1;
  movePath: Position[] = [];
  hoveredTile: Position | null = null;
  animations: AnimationManager | null = null;
  isAnimating = false;
  animatingUnits = new Set<string>();
  pendingDestinations = new Map<string, Position>();
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
    return this.phase === 'player' && !this.autoBattle;
  }

  get hasBusyAnimations(): boolean {
    return this.turnMode === 'simultaneous'
      ? this.animatingUnits.size > 0
      : this.isAnimating;
  }

  private canExecutePlayerAction(): boolean {
    if (this.phase !== 'player') return false;
    if (this.turnMode === 'sequential' && this.isAnimating) return false;
    if (this.turnMode === 'simultaneous' && this.selectedUnit && this.animatingUnits.has(this.selectedUnit.id)) {
      return false;
    }
    return true;
  }

  private canSelectedUnitAct(): boolean {
    return this.canExecutePlayerAction() && !!this.selectedUnit;
  }

  toggleTurnMode(): void {
    if (this.autoBattle || this.phase === 'victory' || this.phase === 'defeat') return;
    if (this.hasBusyAnimations) return;

    this.turnMode = this.turnMode === 'sequential' ? 'simultaneous' : 'sequential';
    this.log(
      this.turnMode === 'simultaneous'
        ? 'Режим: параллельный — обе команды действуют одновременно за раунд.'
        : 'Режим: по очереди — один солдат за раз.',
      'info'
    );
    this.notify();
  }

  occupiedForUnit(unit: Unit): Set<string> {
    const occupied = this.occupiedTiles;
    occupied.delete(`${unit.position.x},${unit.position.y}`);
    for (const [uid, pos] of this.pendingDestinations) {
      if (uid !== unit.id) occupied.add(`${pos.x},${pos.y}`);
    }
    return occupied;
  }

  private beginUnitAnimation(unitId: string): void {
    if (this.turnMode === 'simultaneous') {
      this.animatingUnits.add(unitId);
    } else {
      this.isAnimating = true;
    }
  }

  private endUnitAnimation(unitId: string): void {
    if (this.turnMode === 'simultaneous') {
      this.animatingUnits.delete(unitId);
    } else {
      this.isAnimating = false;
    }
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
    if (!this.selectedUnit || !this.canSelectedUnitAct()) return;
    this.actionMode = mode;
    this.movePath = [];
    this.notify();
  }

  getReachableTiles(): Position[] {
    if (!this.selectedUnit) return [];
    return this.grid.getReachableTiles(
      this.selectedUnit.position,
      this.selectedUnit.mobility,
      this.occupiedForUnit(this.selectedUnit)
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
        if (this.hasBusyAnimations) {
          await delay(60);
          continue;
        }

        if (this.phase !== 'player') {
          await delay(60);
          continue;
        }

        if (this.turnMode === 'simultaneous') {
          const anyActive =
            this.aliveSoldiers.some(s => s.actionPoints > 0) ||
            this.aliveAliens.some(a => a.actionPoints > 0);

          if (!anyActive) {
            await this.finishSimultaneousRound();
            await delay(350);
            continue;
          }

          await this.runSimultaneousParallelTick();
          await delay(280);
        } else {
          const active = this.aliveSoldiers.filter(s => s.actionPoints > 0);
          if (active.length === 0) {
            await this.endPlayerTurn();
            await delay(350);
            continue;
          }

          const soldier = active[0];
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
      }
    } finally {
      this.autoBattleRunning = false;
      if (this.phase === 'victory' || this.phase === 'defeat') {
        this.autoBattle = false;
      }
      this.notify();
    }
  }

  private async runSimultaneousParallelTick(): Promise<boolean> {
    const simOccupied = new Set(this.occupiedTiles);
    const executors: Array<() => Promise<void>> = [];

    for (const soldier of this.aliveSoldiers.filter(s => s.actionPoints > 0)) {
      const action = planNextSoldierAction(
        soldier,
        this.aliens,
        this.soldiers,
        this.grid,
        simOccupied
      );

      if (!action || action.type === 'wait') {
        soldier.actionPoints = 0;
        continue;
      }

      executors.push(() => this.executeSoldierAIAction(action));
      this.reserveSimulatedAction(action, simOccupied);
    }

    const alienActions = planAlienTurn(this.aliens, this.soldiers, this.grid, simOccupied);
    for (const action of alienActions) {
      executors.push(() => this.executeAIAction(action));
    }

    if (executors.length === 0) {
      this.notify();
      return false;
    }

    await Promise.all(executors.map(run => run()));
    await delay(200);
    this.notify();
    return true;
  }

  private async finishSimultaneousRound(): Promise<void> {
    await this.checkOverwatchAnimated('alien');
    await this.checkOverwatchAnimated('soldier');
    this.checkVictory();
    if (this.phase === 'player') {
      await this.startNextRound();
    }
  }

  private reserveSimulatedAction(action: AIAction, simOccupied: Set<string>): void {
    if (action.type === 'move' && action.endPos) {
      const pos = action.unit.position;
      simOccupied.delete(`${pos.x},${pos.y}`);
      simOccupied.add(`${action.endPos.x},${action.endPos.y}`);
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
    if (!this.canInteract || !this.selectedUnit || !this.canSelectedUnitAct()) return;

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
    if (!this.canInteract || !this.canSelectedUnitAct()) return;
    this.hoveredTile = pos;
    if (pos && this.actionMode === 'move' && this.selectedUnit) {
      const path = this.grid.findApproachPath(
        this.selectedUnit.position,
        pos,
        this.occupiedForUnit(this.selectedUnit),
        this.selectedUnit.mobility
      );
      this.movePath = path ?? [];
    } else {
      this.movePath = [];
    }
  }

  private async tryMove(dest: Position): Promise<void> {
    const unit = this.selectedUnit!;
    const reachable = this.getReachableTiles();
    if (!reachable.some(p => p.x === dest.x && p.y === dest.y)) return;

    const occupied = this.occupiedForUnit(unit);
    const path = this.grid.findApproachPath(
      unit.position,
      dest,
      occupied,
      unit.mobility
    );
    if (!path || path.length <= 1) return;
    if (unit.actionPoints < 1) return;

    this.beginUnitAnimation(unit.id);
    this.pendingDestinations.set(unit.id, dest);
    this.actionMode = null;
    this.movePath = [];

    if (this.animations) {
      await this.animations.animateMove(unit, path);
    }

    unit.position = dest;
    unit.actionPoints -= 1;
    unit.hasMoved = true;

    this.pendingDestinations.delete(unit.id);
    this.log(`${unit.name} перемещается.`, 'info');
    this.endUnitAnimation(unit.id);
    this.checkAutoEndUnit();
    this.notify();
  }

  private async tryShootAt(aimPos: Position): Promise<void> {
    await this.executeShootAtTile(this.selectedUnit!, aimPos);
  }

  private async executeShootAtTile(shooter: Unit, aimPos: Position): Promise<void> {
    if (shooter.actionPoints < 1 || shooter.hasActed) return;

    const ray = traceShotRay(shooter, aimPos, this.grid, this.allUnits);
    if (!ray) return;

    resolveRayUnitHits(shooter, ray.hits, this.grid);

    this.beginUnitAnimation(shooter.id);
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
      await Promise.all(killedUnits.map(k => this.animations!.playDeath(k.id)));
    }

    this.endUnitAnimation(shooter.id);
    this.checkVictory();
    this.checkAutoEndUnit();
    this.notify();
  }

  private async tryGrenade(pos: Position): Promise<void> {
    const unit = this.selectedUnit!;
    if (unit.actionPoints < 1 || unit.hasActed) return;

    const dist = this.grid.manhattan(unit.position, pos);
    if (dist > 8) return;

    this.beginUnitAnimation(unit.id);
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
      await Promise.all(killedUnits.map(k => this.animations!.playDeath(k.id)));
    }

    this.endUnitAnimation(unit.id);
    this.checkVictory();
    this.checkAutoEndUnit();
    this.notify();
  }

  async setOverwatch(): Promise<void> {
    const unit = this.selectedUnit!;
    if (unit.actionPoints < 1 || unit.hasActed || !this.canExecutePlayerAction()) return;

    this.beginUnitAnimation(unit.id);
    unit.isOverwatching = true;
    unit.actionPoints = 0;
    unit.hasActed = true;
    this.actionMode = null;

    if (this.animations) {
      this.animations.playOverwatchActivate(unit.id);
      await delay(400);
    }

    this.log(`${unit.name} на дозоре.`, 'info');
    this.endUnitAnimation(unit.id);
    this.checkAutoEndUnit();
    this.notify();
  }

  private checkAutoEndUnit(): void {
    if (this.turnMode !== 'sequential') return;
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

  allAliensDone(): boolean {
    return this.aliveAliens.every(a => a.actionPoints <= 0);
  }

  async endPlayerTurn(): Promise<void> {
    if (this.phase !== 'player') return;
    if (this.turnMode === 'sequential' && this.isAnimating) return;

    while (this.animatingUnits.size > 0) {
      await delay(50);
    }

    if (this.turnMode === 'simultaneous') {
      await this.resolveSimultaneousRoundEnd();
      return;
    }

    for (const s of this.aliveSoldiers) {
      if (s.actionPoints > 0) s.actionPoints = 0;
    }

    await this.checkOverwatchAnimated('alien');

    this.phase = 'enemy';
    this.selectedUnit = null;
    this.actionMode = null;
    this.log('--- Ход пришельцев ---', 'info');
    this.notify();

    await this.runEnemyTurn();
  }

  private async resolveSimultaneousRoundEnd(): Promise<void> {
    this.log('--- Конец раунда: пришельцы и оставшиеся солдаты ---', 'info');
    this.notify();

    while (
      this.aliveSoldiers.some(s => s.actionPoints > 0) ||
      this.aliveAliens.some(a => a.actionPoints > 0)
    ) {
      const acted = await this.runSimultaneousParallelTick();
      if (!acted) break;
      if (this.phase !== 'player') return;

      while (this.animatingUnits.size > 0) {
        await delay(50);
      }
    }

    await this.finishSimultaneousRound();
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
        this.beginUnitAnimation(watcher.id);

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

        this.endUnitAnimation(watcher.id);
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
      this.beginUnitAnimation(action.unit.id);
      action.unit.hasMoved = true;
      action.unit.actionPoints = Math.max(0, action.unit.actionPoints - 1);

      if (this.animations) {
        await this.animations.animateMove(action.unit, action.path);
      }
      action.unit.position = action.endPos;
      this.log(`${action.unit.name} перемещается.`, 'info');
      this.endUnitAnimation(action.unit.id);
      this.notify();
    } else if (action.type === 'shoot' && action.aimPos && !action.shotResult) {
      await this.executeShootAtTile(action.unit, action.aimPos);
    } else if (action.type === 'shoot' && action.target && action.shotResult) {
      this.beginUnitAnimation(action.unit.id);
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

      this.endUnitAnimation(action.unit.id);
      this.checkVictory();
      this.notify();
    } else if (action.type === 'overwatch') {
      action.unit.isOverwatching = true;
      action.unit.hasActed = true;
      action.unit.actionPoints = 0;
      this.log(`${action.unit.name} на дозоре.`, 'info');
      if (this.animations) this.animations.playOverwatchActivate(action.unit.id);
      this.notify();
    }
  }

  private async startNextRound(): Promise<void> {
    this.turnNumber++;
    for (const s of this.soldiers) {
      if (s.isAlive) resetUnitTurn(s);
    }
    for (const a of this.aliens) {
      if (a.isAlive) resetUnitTurn(a);
    }
    this.phase = 'player';
    this.selectedUnit = null;
    this.actionMode = null;
    this.movePath = [];
    const modeLabel = this.turnMode === 'simultaneous' ? 'параллельный' : 'по очереди';
    this.log(`--- Раунд ${this.turnNumber} (${modeLabel}) ---`, 'info');
    this.selectFirstAvailableSoldier();
    this.notify();
  }

  private startPlayerTurn(): void {
    this.turnNumber++;
    for (const s of this.soldiers) {
      if (s.isAlive) resetUnitTurn(s);
    }
    this.phase = 'player';
    const modeLabel = this.turnMode === 'simultaneous' ? 'параллельный' : 'по очереди';
    this.log(`--- Ход XCOM (раунд ${this.turnNumber}, ${modeLabel}) ---`, 'info');
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
    this.animatingUnits.clear();
    this.pendingDestinations.clear();
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