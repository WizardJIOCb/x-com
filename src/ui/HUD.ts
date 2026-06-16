import type { ActionMode, Unit } from '../types';
import type { Battle } from '../game/Battle';

export class HUD {
  private unitPanel: HTMLElement;
  private actionBar: HTMLElement;
  private combatLog: HTMLElement;
  private missionInfo: HTMLElement;
  private endTurnBtn: HTMLButtonElement;
  private autoBattleBtn: HTMLButtonElement;
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlayText: HTMLElement;
  private overlayBtn: HTMLButtonElement;

  private onEndTurn: (() => void) | null = null;
  private onAutoBattle: (() => void) | null = null;
  private onRestart: (() => void) | null = null;
  private onActionMode: ((mode: ActionMode) => void) | null = null;
  private onSelectUnit: ((unit: Unit) => void) | null = null;
  private onOverwatch: (() => void) | null = null;

  private lastHudState = '';
  private _battle: Battle | null = null;

  constructor() {
    this.unitPanel = document.getElementById('unit-panel')!;
    this.actionBar = document.getElementById('action-bar')!;
    this.combatLog = document.getElementById('combat-log')!;
    this.missionInfo = document.getElementById('mission-info')!;
    this.endTurnBtn = document.getElementById('btn-end-turn') as HTMLButtonElement;
    this.autoBattleBtn = document.getElementById('btn-auto-battle') as HTMLButtonElement;
    this.overlay = document.getElementById('overlay')!;
    this.overlayTitle = document.getElementById('overlay-title')!;
    this.overlayText = document.getElementById('overlay-text')!;
    this.overlayBtn = document.getElementById('overlay-btn') as HTMLButtonElement;

    this.endTurnBtn.addEventListener('click', () => this.onEndTurn?.());
    this.autoBattleBtn.addEventListener('click', () => this.onAutoBattle?.());
    this.overlayBtn.addEventListener('click', () => {
      this.overlay.classList.add('hidden');
      this.onRestart?.();
    });

    this.actionBar.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (!target || target.disabled || !this._battle) return;
      const action = target.dataset.action;
      if (action === 'overwatch') {
        this.onOverwatch?.();
      } else if (action) {
        const mode = action as ActionMode;
        const current = this._battle.actionMode;
        this.onActionMode?.(current === mode ? null : mode);
      }
    });
  }

  setCallbacks(callbacks: {
    onEndTurn: () => void;
    onAutoBattle: () => void;
    onRestart: () => void;
    onActionMode: (mode: ActionMode) => void;
    onSelectUnit: (unit: Unit) => void;
    onOverwatch: () => void;
  }): void {
    this.onEndTurn = callbacks.onEndTurn;
    this.onAutoBattle = callbacks.onAutoBattle;
    this.onRestart = callbacks.onRestart;
    this.onActionMode = callbacks.onActionMode;
    this.onSelectUnit = callbacks.onSelectUnit;
    this.onOverwatch = callbacks.onOverwatch;
  }

  update(battle: Battle): void {
    this._battle = battle;
    const stateKey = JSON.stringify({
      phase: battle.phase,
      anim: battle.isAnimating,
      auto: battle.autoBattle,
      turn: battle.turnNumber,
      sel: battle.selectedUnit?.id,
      ap: battle.selectedUnit?.actionPoints,
      acted: battle.selectedUnit?.hasActed,
      mode: battle.actionMode,
      soldiers: battle.soldiers.map(s => [s.id, s.hp, s.isAlive, s.actionPoints, s.isOverwatching]),
      aliens: battle.aliens.map(a => [a.id, a.hp, a.isAlive]),
      logLen: battle.combatLog.length,
    });

    this.renderMissionInfo(battle);
    if (stateKey !== this.lastHudState) {
      this.lastHudState = stateKey;
      this.renderUnitPanel(battle);
      this.renderActionBar(battle);
      this.renderCombatLog(battle);
    }
    this.renderOverlay(battle);
  }

  private renderMissionInfo(battle: Battle): void {
    const alive = battle.aliveSoldiers.length;
    const aliens = battle.aliveAliens.length;
    const phase = battle.phase === 'player' ? 'Ход XCOM' : battle.phase === 'enemy' ? 'Ход пришельцев' : '';
    const autoTag = battle.autoBattle ? ' · 🤖 Автобой' : '';
    this.missionInfo.textContent =
      `Раунд ${battle.turnNumber} · ${phase}${autoTag} · Карта 50×38 · Солдаты: ${alive} · Пришельцы: ${aliens}`;
  }

  private renderUnitPanel(battle: Battle): void {
    this.unitPanel.innerHTML = '<div class="section-title">Отряд XCOM</div>';

    for (const soldier of battle.soldiers) {
      const card = document.createElement('div');
      card.className = 'unit-card';
      if (!soldier.isAlive) card.classList.add('dead');
      if (battle.selectedUnit?.id === soldier.id) card.classList.add('selected');

      const hpPct = Math.round((soldier.hp / soldier.maxHp) * 100);
      const apDots = Array.from({ length: soldier.maxActionPoints }, (_, i) =>
        `<span class="ap-dot${i < soldier.actionPoints ? '' : ' spent'}"></span>`
      ).join('');

      card.innerHTML = `
        <div class="name">${soldier.name}</div>
        <div class="class-tag">${soldier.className}</div>
        <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%"></div></div>
        <div class="unit-stats">
          <span>HP: ${soldier.hp}/${soldier.maxHp}</span>
          <span>ОД: ${soldier.actionPoints}</span>
          <span>Точность: ${soldier.aim}%</span>
          <span>${soldier.weapon.name}</span>
        </div>
        <div class="ap-dots">${apDots}</div>
        ${soldier.isOverwatching ? '<div style="color:var(--warning);font-size:11px;margin-top:4px">⚠ На дозоре</div>' : ''}
      `;

      card.addEventListener('click', () => this.onSelectUnit?.(soldier));
      this.unitPanel.appendChild(card);
    }

    const alienTitle = document.createElement('div');
    alienTitle.className = 'section-title';
    alienTitle.textContent = 'Противник';
    this.unitPanel.appendChild(alienTitle);

    for (const alien of battle.aliens) {
      const card = document.createElement('div');
      card.className = 'unit-card';
      if (!alien.isAlive) card.classList.add('dead');

      card.innerHTML = `
        <div class="name">${alien.name}</div>
        <div class="class-tag" style="color:var(--alien)">${alien.className}</div>
        <div class="hp-bar"><div class="hp-fill" style="width:${Math.round((alien.hp / alien.maxHp) * 100)}%"></div></div>
        <div class="unit-stats">
          <span>HP: ${alien.isAlive ? `${alien.hp}/${alien.maxHp}` : 'Мёртв'}</span>
        </div>
      `;
      this.unitPanel.appendChild(card);
    }
  }

  private renderActionBar(battle: Battle): void {
    this.actionBar.innerHTML = '';
    const unit = battle.selectedUnit;
    const isPlayerTurn = battle.phase === 'player' && !battle.isAnimating;
    const battleOver = battle.phase === 'victory' || battle.phase === 'defeat';

    this.endTurnBtn.disabled = !isPlayerTurn || battle.autoBattle;
    this.autoBattleBtn.disabled = battleOver;
    this.autoBattleBtn.classList.toggle('active', battle.autoBattle);
    this.autoBattleBtn.textContent = battle.autoBattle ? '⏹ Стоп' : '⚡ Автобой';

    if (!unit || !isPlayerTurn) {
      const msg = battle.autoBattle
        ? '<span style="color:var(--warning);font-size:13px">🤖 Автобой — тактические решения...</span>'
        : battle.isAnimating
          ? '<span style="color:var(--accent);font-size:13px">⚡ Анимация...</span>'
          : '<span style="color:var(--text-dim);font-size:13px">Ожидание...</span>';
      this.actionBar.innerHTML = msg;
      return;
    }

    const actions: { mode: ActionMode; label: string; disabled: boolean }[] = [
      { mode: 'move', label: '↔ Движение', disabled: unit.actionPoints < 1 || battle.isAnimating },
      { mode: 'shoot', label: '◎ Стрельба', disabled: unit.actionPoints < 1 || unit.hasActed || battle.isAnimating },
      { mode: 'overwatch', label: '👁 Дозор', disabled: unit.actionPoints < 1 || unit.hasActed || battle.isAnimating },
      { mode: 'grenade', label: '💣 Граната', disabled: unit.actionPoints < 1 || unit.hasActed || battle.isAnimating },
    ];

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      if (battle.actionMode === action.mode) btn.classList.add('active');
      btn.textContent = action.label;
      btn.disabled = action.disabled;
      btn.dataset.action = action.mode ?? '';
      this.actionBar.appendChild(btn);
    }

    if (unit.actionPoints <= 0) {
      const hint = document.createElement('span');
      hint.style.cssText = 'color:var(--text-dim);font-size:12px;margin-left:12px';
      hint.textContent = 'Нет очков действия';
      this.actionBar.appendChild(hint);
    }
  }

  private renderCombatLog(battle: Battle): void {
    this.combatLog.innerHTML = battle.combatLog
      .map(entry => `<div class="log-entry ${entry.type}">${entry.text}</div>`)
      .join('');
  }

  private renderOverlay(battle: Battle): void {
    if (battle.phase === 'victory') {
      this.overlay.classList.remove('hidden');
      this.overlayTitle.textContent = 'МИССИЯ ВЫПОЛНЕНА';
      this.overlayText.textContent =
        `Отряд XCOM успешно зачистил район. Уничтожено пришельцев: ${battle.aliens.length}. Раундов: ${battle.turnNumber}.`;
      this.overlayBtn.textContent = 'Новая миссия';
    } else if (battle.phase === 'defeat') {
      this.overlay.classList.remove('hidden');
      this.overlayTitle.textContent = 'МИССИЯ ПРОВАЛЕНА';
      this.overlayText.textContent = 'Все солдаты погибли. Земля нуждается в новом отряде.';
      this.overlayBtn.textContent = 'Попробовать снова';
    }
  }
}