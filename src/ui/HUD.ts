import type { ActionMode, Unit } from '../types';
import type { Battle } from '../game/Battle';

type MobileTab = 'map' | 'squad' | 'enemies' | 'log';

export class HUD {
  private squadSection: HTMLElement;
  private enemySection: HTMLElement;
  private soldierStrip: HTMLElement;
  private actionBar: HTMLElement;
  private combatLog: HTMLElement;
  private missionInfo: HTMLElement;
  private unitPanel: HTMLElement;
  private logPanel: HTMLElement;
  private endTurnBtn: HTMLButtonElement;
  private turnModeBtn: HTMLButtonElement;
  private autoBattleBtn: HTMLButtonElement;
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlayText: HTMLElement;
  private overlayBtn: HTMLButtonElement;
  private mobileDock: HTMLElement | null;

  private onEndTurn: (() => void) | null = null;
  private onAutoBattle: (() => void) | null = null;
  private onRestart: (() => void) | null = null;
  private onActionMode: ((mode: ActionMode) => void) | null = null;
  private onSelectUnit: ((unit: Unit) => void) | null = null;
  private onOverwatch: (() => void) | null = null;
  private onToggleTurnMode: (() => void) | null = null;

  private lastHudState = '';
  private _battle: Battle | null = null;
  private mobileTab: MobileTab = 'map';
  private isMobile = false;

  constructor() {
    this.unitPanel = document.getElementById('unit-panel')!;
    this.squadSection = document.getElementById('squad-section')!;
    this.enemySection = document.getElementById('enemy-section')!;
    this.soldierStrip = document.getElementById('soldier-strip')!;
    this.logPanel = document.getElementById('log-panel')!;
    this.actionBar = document.getElementById('action-bar')!;
    this.combatLog = document.getElementById('combat-log')!;
    this.missionInfo = document.getElementById('mission-info')!;
    this.endTurnBtn = document.getElementById('btn-end-turn') as HTMLButtonElement;
    this.turnModeBtn = document.getElementById('btn-turn-mode') as HTMLButtonElement;
    this.autoBattleBtn = document.getElementById('btn-auto-battle') as HTMLButtonElement;
    this.overlay = document.getElementById('overlay')!;
    this.overlayTitle = document.getElementById('overlay-title')!;
    this.overlayText = document.getElementById('overlay-text')!;
    this.overlayBtn = document.getElementById('overlay-btn') as HTMLButtonElement;
    this.mobileDock = document.getElementById('mobile-dock');

    this.endTurnBtn.addEventListener('click', () => this.onEndTurn?.());
    this.turnModeBtn.addEventListener('click', () => this.onToggleTurnMode?.());
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

    this.initMobileUI();
  }

  private initMobileUI(): void {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => {
      const wasMobile = this.isMobile;
      this.isMobile = mq.matches;
      document.body.dataset.mobileTab = this.mobileTab;
      this.syncMobilePanels();
      if (wasMobile !== this.isMobile) {
        this.lastHudState = '';
        if (this._battle) this.update(this._battle);
      }
    };
    mq.addEventListener('change', apply);
    apply();

    this.mobileDock?.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('.dock-tab');
      if (!tab?.dataset.tab) return;
      this.setMobileTab(tab.dataset.tab as MobileTab);
    });
  }

  private setMobileTab(tab: MobileTab): void {
    this.mobileTab = tab;
    document.body.dataset.mobileTab = tab;
    this.mobileDock?.querySelectorAll('.dock-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    this.syncMobilePanels();
  }

  private syncMobilePanels(): void {
    if (!this.isMobile) {
      this.unitPanel.classList.remove('open');
      this.logPanel.classList.remove('open');
      return;
    }
    this.unitPanel.classList.toggle('open', this.mobileTab === 'squad' || this.mobileTab === 'enemies');
    this.logPanel.classList.toggle('open', this.mobileTab === 'log');
  }

  setCallbacks(callbacks: {
    onEndTurn: () => void;
    onAutoBattle: () => void;
    onRestart: () => void;
    onActionMode: (mode: ActionMode) => void;
    onSelectUnit: (unit: Unit) => void;
    onOverwatch: () => void;
    onToggleTurnMode: () => void;
  }): void {
    this.onEndTurn = callbacks.onEndTurn;
    this.onAutoBattle = callbacks.onAutoBattle;
    this.onRestart = callbacks.onRestart;
    this.onActionMode = callbacks.onActionMode;
    this.onSelectUnit = callbacks.onSelectUnit;
    this.onOverwatch = callbacks.onOverwatch;
    this.onToggleTurnMode = callbacks.onToggleTurnMode;
  }

  update(battle: Battle): void {
    this._battle = battle;
    const stateKey = JSON.stringify({
      phase: battle.phase,
      anim: battle.isAnimating,
      turnMode: battle.turnMode,
      busy: battle.hasBusyAnimations,
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
      this.renderSquadPanel(battle);
      this.renderEnemyPanel(battle);
      this.renderSoldierStrip(battle);
      this.renderActionBar(battle);
      this.renderCombatLog(battle);
    }
    this.renderOverlay(battle);
  }

  private renderMissionInfo(battle: Battle): void {
    const alive = battle.aliveSoldiers.length;
    const aliens = battle.aliveAliens.length;
    const phase =
      battle.phase === 'player'
        ? battle.turnMode === 'simultaneous'
          ? 'Раунд'
          : 'Ход XCOM'
        : battle.phase === 'enemy'
          ? 'Ход пришельцев'
          : '';
    const autoTag = battle.autoBattle ? ' · 🤖' : '';
    const modeTag = battle.turnMode === 'simultaneous' ? ' · ⚡Параллель' : '';

    if (this.isMobile) {
      this.missionInfo.textContent = `R${battle.turnNumber} · ${phase}${modeTag}${autoTag} · 👤${alive} 👾${aliens}`;
      return;
    }

    this.missionInfo.textContent =
      `Раунд ${battle.turnNumber} · ${phase}${modeTag}${autoTag} · Карта 50×38 · Солдаты: ${alive} · Пришельцы: ${aliens}`;
  }

  private renderSquadPanel(battle: Battle): void {
    this.squadSection.innerHTML = '<div class="section-title">Отряд XCOM</div>';

    for (const soldier of battle.soldiers) {
      const card = this.createSoldierCard(soldier, battle.selectedUnit?.id === soldier.id);
      this.squadSection.appendChild(card);
    }
  }

  private renderEnemyPanel(battle: Battle): void {
    this.enemySection.innerHTML = '<div class="section-title">Противник</div>';

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
      this.enemySection.appendChild(card);
    }
  }

  private renderSoldierStrip(battle: Battle): void {
    this.soldierStrip.innerHTML = '';

    for (const soldier of battle.soldiers) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'soldier-chip';
      if (!soldier.isAlive) chip.classList.add('dead');
      if (battle.selectedUnit?.id === soldier.id) chip.classList.add('selected');

      const hpPct = Math.round((soldier.hp / soldier.maxHp) * 100);
      const apDots = Array.from({ length: soldier.maxActionPoints }, (_, i) =>
        `<span class="chip-ap-dot${i < soldier.actionPoints ? '' : ' spent'}"></span>`
      ).join('');

      chip.innerHTML = `
        <span class="chip-name">${soldier.name}</span>
        <span class="chip-class">${soldier.className.slice(0, 3)}</span>
        <span class="chip-hp"><span class="chip-hp-fill" style="width:${hpPct}%"></span></span>
        <span class="chip-ap">${apDots}</span>
      `;

      chip.addEventListener('click', () => {
        this.onSelectUnit?.(soldier);
        if (this.isMobile) this.setMobileTab('map');
      });
      this.soldierStrip.appendChild(chip);
    }
  }

  private createSoldierCard(soldier: Unit, selected: boolean): HTMLElement {
    const card = document.createElement('div');
    card.className = 'unit-card';
    if (!soldier.isAlive) card.classList.add('dead');
    if (selected) card.classList.add('selected');

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

    card.addEventListener('click', () => {
      this.onSelectUnit?.(soldier);
      if (this.isMobile) this.setMobileTab('map');
    });
    return card;
  }

  private renderActionBar(battle: Battle): void {
    this.actionBar.innerHTML = '';
    const unit = battle.selectedUnit;
    const isPlayerTurn = battle.phase === 'player';
    const battleOver = battle.phase === 'victory' || battle.phase === 'defeat';
    const unitBusy = unit ? battle.animatingUnits.has(unit.id) : false;
    const canActUnit = isPlayerTurn && !battle.autoBattle && unit && !unitBusy &&
      (battle.turnMode === 'sequential' ? !battle.isAnimating : true);

    this.endTurnBtn.disabled = !isPlayerTurn || battle.autoBattle || battle.hasBusyAnimations;
    this.endTurnBtn.textContent =
      battle.turnMode === 'simultaneous' ? '⏭ Конец раунда' : '⏭ Конец хода';
    this.endTurnBtn.title =
      battle.turnMode === 'simultaneous'
        ? 'Завершить раунд — пришельцы и оставшиеся солдаты действуют параллельно'
        : 'Завершить ход XCOM';
    this.autoBattleBtn.disabled = battleOver;
    this.autoBattleBtn.classList.toggle('active', battle.autoBattle);
    this.autoBattleBtn.textContent = battle.autoBattle ? '⏹ Стоп' : '⚡ Автобой';

    const isParallel = battle.turnMode === 'simultaneous';
    this.turnModeBtn.disabled = battleOver || battle.autoBattle || battle.hasBusyAnimations;
    this.turnModeBtn.classList.toggle('active', isParallel);
    this.turnModeBtn.textContent = isParallel ? '⚡ Параллель' : '🔄 По очереди';
    this.turnModeBtn.title = isParallel
      ? 'Параллельный режим — обе команды действуют одновременно за раунд'
      : 'Классический режим — солдаты по очереди, затем пришельцы';

    if (!unit || !isPlayerTurn || battle.autoBattle) {
      const msg = battle.autoBattle
        ? '<span style="color:var(--warning);font-size:13px">🤖 Автобой — тактические решения...</span>'
        : battle.hasBusyAnimations && battle.turnMode === 'simultaneous'
          ? '<span style="color:var(--accent);font-size:13px">⚡ Юниты выполняют действия...</span>'
        : battle.isAnimating
          ? '<span style="color:var(--accent);font-size:13px">⚡ Анимация...</span>'
          : '<span style="color:var(--text-dim);font-size:13px">Ожидание...</span>';
      this.actionBar.innerHTML = msg;
      return;
    }

    const actions: { mode: ActionMode; label: string; short: string; disabled: boolean }[] = [
      { mode: 'move', label: '↔ Движение', short: '↔', disabled: unit.actionPoints < 1 || !canActUnit },
      { mode: 'shoot', label: '◎ Стрельба', short: '◎', disabled: unit.actionPoints < 1 || unit.hasActed || !canActUnit },
      { mode: 'overwatch', label: '👁 Дозор', short: '👁', disabled: unit.actionPoints < 1 || unit.hasActed || !canActUnit },
      { mode: 'grenade', label: '💣 Граната', short: '💣', disabled: unit.actionPoints < 1 || unit.hasActed || !canActUnit },
    ];

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      if (battle.actionMode === action.mode) btn.classList.add('active');
      btn.textContent = this.isMobile ? action.short : action.label;
      btn.title = action.label;
      btn.disabled = action.disabled;
      btn.dataset.action = action.mode ?? '';
      this.actionBar.appendChild(btn);
    }

    if (unit.actionPoints <= 0 && !this.isMobile) {
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
    this.combatLog.scrollTop = this.combatLog.scrollHeight;
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