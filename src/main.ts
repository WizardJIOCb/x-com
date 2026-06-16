import { Battle } from './game/Battle';
import { Renderer3D } from './game/Renderer3D';
import { AnimationManager } from './game/Animations';
import { HUD } from './ui/HUD';
import type { ActionMode } from './types';
import { TRIPO_MODEL_COUNTS } from './game/ModelCatalog';
import { modelLoader } from './game/ModelLoader';

function showLoadingOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'loading-overlay';
  el.style.cssText = `
    position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
    background:#0a0e14;color:#7ee8ff;font:bold 18px 'Segoe UI',sans-serif;z-index:9999;
  `;
  el.textContent = 'Загрузка 3D-моделей...';
  document.body.appendChild(el);
  return el;
}

class Game {
  battle: Battle;
  renderer: Renderer3D;
  animations: AnimationManager;
  hud: HUD;
  lastTime = 0;

  constructor() {
    const container = document.getElementById('game-container')!;
    this.animations = new AnimationManager();
    this.battle = new Battle();
    this.battle.animations = this.animations;
    this.renderer = new Renderer3D(container);
    this.animations.labelContainer = this.renderer.labelsParent;
    this.hud = new HUD();

    this.hud.setCallbacks({
      onEndTurn: () => void this.battle.endPlayerTurn(),
      onAutoBattle: () => this.battle.toggleAutoBattle(),
      onRestart: () => {
        this.battle.restart();
        this.renderer.rebuild(this.battle);
        this.hud.update(this.battle);
      },
      onActionMode: (mode: ActionMode) => {
        this.battle.setActionMode(mode);
      },
      onSelectUnit: (unit) => {
        this.battle.selectUnit(unit);
      },
      onOverwatch: () => void this.battle.setOverwatch(),
    });

    this.battle.onUpdate = () => this.hud.update(this.battle);
    this.battle.onMapChange = (tiles) => this.renderer.updateTilesAt(this.battle, tiles);
    this.hud.update(this.battle);

    const canvas = this.renderer.renderer.domElement;
    const cameraInput = this.renderer.cameraInput;

    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!cameraInput.consumeClick()) {
        cameraInput.resetClickState();
        return;
      }
      const pos = this.renderer.screenToGrid(e.clientX, e.clientY);
      if (pos) void this.battle.handleTileClick(pos);
      cameraInput.resetClickState();
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (cameraInput.isPanning) return;
      const pos = this.renderer.screenToGrid(e.clientX, e.clientY);
      this.battle.handleTileHover(pos);
    });

    window.addEventListener('resize', () => this.renderer.resize());

    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(time: number): void {
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;

    this.animations.update(dt);
    this.renderer.render(this.battle, this.animations, dt);

    requestAnimationFrame((t) => this.loop(t));
  }
}

async function bootstrap(): Promise<void> {
  const overlay = showLoadingOverlay();
  try {
    await modelLoader.loadAll();
    const c = TRIPO_MODEL_COUNTS;
    overlay.textContent =
      `Загружено ${modelLoader.loadedCount} моделей, ${c.textures} текстур`;
    await new Promise(r => setTimeout(r, 400));
  } catch (err) {
    console.error(err);
    overlay.textContent = 'Ошибка загрузки моделей, процедурная графика...';
    await new Promise(r => setTimeout(r, 800));
  } finally {
    overlay.remove();
  }
  new Game();
}

void bootstrap();