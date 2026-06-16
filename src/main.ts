import { Battle } from './game/Battle';
import { Renderer3D } from './game/Renderer3D';
import { AnimationManager } from './game/Animations';
import { buildAssetManifest, probeAssetSizes } from './game/buildAssetManifest';
import { loadProgress } from './game/LoadProgress';
import { modelLoader } from './game/ModelLoader';
import { HUD } from './ui/HUD';
import { LoadingScreen } from './ui/LoadingScreen';
import type { ActionMode } from './types';

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
  const loader = new LoadingScreen();
  loader.attach();

  const manifest = buildAssetManifest();
  loadProgress.init(manifest);

  let ok = true;
  try {
    const totalBytes = await probeAssetSizes(manifest.map(item => item.url));
    loadProgress.setTotalBytes(totalBytes);
    await modelLoader.loadAll();
  } catch (err) {
    ok = false;
    console.error(err);
    loadProgress.setPhase('error', 'Ошибка загрузки');
  }

  await loader.finish(ok);
  new Game();
}

void bootstrap();