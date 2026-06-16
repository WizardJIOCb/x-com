import type { LoadProgressSnapshot } from '../game/LoadProgress';
import { loadProgress } from '../game/LoadProgress';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function kindLabel(kind: LoadProgressSnapshot['currentKind']): string {
  if (kind === 'model') return 'Модель';
  if (kind === 'texture') return 'Текстура';
  return 'Ресурс';
}

export class LoadingScreen {
  private root: HTMLElement;
  private percentEl: HTMLElement;
  private barFill: HTMLElement;
  private barGlow: HTMLElement;
  private fileBarFill: HTMLElement;
  private filesEl: HTMLElement;
  private bytesEl: HTMLElement;
  private modelsEl: HTMLElement;
  private texturesEl: HTMLElement;
  private currentEl: HTMLElement;
  private statusEl: HTMLElement;
  private unsub: (() => void) | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'loading-screen';
    this.root.innerHTML = `
      <div class="loader-grid"></div>
      <div class="loader-scan"></div>
      <div class="loader-panel">
        <div class="loader-brand">
          <div class="loader-logo"><span class="loader-logo-x">X</span>COM</div>
          <div class="loader-tagline">TACTICAL DEPLOYMENT</div>
        </div>
        <div class="loader-percent" data-percent>0%</div>
        <div class="loader-bar-wrap">
          <div class="loader-bar-track">
            <div class="loader-bar-fill" data-bar-fill></div>
            <div class="loader-bar-glow" data-bar-glow></div>
          </div>
        </div>
        <div class="loader-stats">
          <div class="loader-stat">
            <span class="loader-stat-label">Файлы</span>
            <span class="loader-stat-value" data-files>0 / 0</span>
          </div>
          <div class="loader-stat">
            <span class="loader-stat-label">Данные</span>
            <span class="loader-stat-value" data-bytes>0 B / 0 B</span>
          </div>
          <div class="loader-stat">
            <span class="loader-stat-label">Модели</span>
            <span class="loader-stat-value" data-models>0</span>
          </div>
          <div class="loader-stat">
            <span class="loader-stat-label">Текстуры</span>
            <span class="loader-stat-value" data-textures>0</span>
          </div>
        </div>
        <div class="loader-file-bar">
          <div class="loader-file-fill" data-file-bar></div>
        </div>
        <div class="loader-current" data-current>Инициализация...</div>
        <div class="loader-status" data-status>Сканирование ресурсов</div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.percentEl = this.root.querySelector('[data-percent]')!;
    this.barFill = this.root.querySelector('[data-bar-fill]')!;
    this.barGlow = this.root.querySelector('[data-bar-glow]')!;
    this.fileBarFill = this.root.querySelector('[data-file-bar]')!;
    this.filesEl = this.root.querySelector('[data-files]')!;
    this.bytesEl = this.root.querySelector('[data-bytes]')!;
    this.modelsEl = this.root.querySelector('[data-models]')!;
    this.texturesEl = this.root.querySelector('[data-textures]')!;
    this.currentEl = this.root.querySelector('[data-current]')!;
    this.statusEl = this.root.querySelector('[data-status]')!;
  }

  attach(): void {
    this.unsub = loadProgress.subscribe(snap => this.render(snap));
  }

  private render(snap: LoadProgressSnapshot): void {
    const pct = Math.min(100, snap.percent);
    this.percentEl.textContent = `${pct}%`;
    this.barFill.style.width = `${pct}%`;
    this.barGlow.style.left = `${pct}%`;

    this.filesEl.textContent = `${snap.completedFiles} / ${snap.totalFiles}`;
    this.modelsEl.textContent = String(snap.modelFiles);
    this.texturesEl.textContent = String(snap.textureFiles);

    if (snap.totalBytes > 0) {
      this.bytesEl.textContent = `${formatBytes(snap.loadedBytes)} / ${formatBytes(snap.totalBytes)}`;
    } else {
      this.bytesEl.textContent = `${formatBytes(snap.loadedBytes)} загружено`;
    }

    const filePct =
      snap.currentFileTotal > 0
        ? Math.round((snap.currentFileLoaded / snap.currentFileTotal) * 100)
        : snap.phase === 'loading'
          ? 35
          : 0;
    this.fileBarFill.style.width = `${filePct}%`;

    const kind = kindLabel(snap.currentKind);
    this.currentEl.textContent =
      snap.phase === 'done'
        ? 'Развёртывание завершено'
        : `${kind}: ${snap.currentLabel}`;

    switch (snap.phase) {
      case 'probe':
        this.statusEl.textContent = 'Сканирование ресурсов';
        break;
      case 'loading':
        this.statusEl.textContent = 'Загрузка тактических ассетов';
        break;
      case 'done':
        this.statusEl.textContent = 'Готово к бою';
        break;
      case 'error':
        this.statusEl.textContent = 'Ошибка загрузки — резервный режим';
        break;
    }
  }

  finish(success: boolean): Promise<void> {
    loadProgress.setPhase(success ? 'done' : 'error');
    this.root.classList.add('loader-exit');

    return new Promise(resolve => {
      this.hideTimer = setTimeout(() => {
        this.destroy();
        resolve();
      }, success ? 650 : 1200);
    });
  }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.unsub?.();
    this.unsub = null;
    this.root.remove();
  }
}