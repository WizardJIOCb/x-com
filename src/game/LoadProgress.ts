export type AssetKind = 'model' | 'texture';

export interface AssetItem {
  url: string;
  label: string;
  kind: AssetKind;
}

export interface LoadProgressSnapshot {
  totalFiles: number;
  completedFiles: number;
  modelFiles: number;
  textureFiles: number;
  totalBytes: number;
  loadedBytes: number;
  currentLabel: string;
  currentKind: AssetKind | null;
  currentFileLoaded: number;
  currentFileTotal: number;
  phase: 'probe' | 'loading' | 'done' | 'error';
  percent: number;
}

type Listener = (snap: LoadProgressSnapshot) => void;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class LoadProgress {
  private listeners = new Set<Listener>();
  private manifest: AssetItem[] = [];
  private completed = new Set<string>();
  private inFlight = new Map<string, { label: string; kind: AssetKind; loaded: number; total: number }>();
  private totalBytes = 0;
  private loadedBytes = 0;
  private phase: LoadProgressSnapshot['phase'] = 'probe';
  private currentLabel = 'Подготовка...';
  private currentKind: AssetKind | null = null;
  private currentFileLoaded = 0;
  private currentFileTotal = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  init(manifest: AssetItem[]): void {
    this.manifest = manifest;
    this.completed.clear();
    this.inFlight.clear();
    this.totalBytes = 0;
    this.loadedBytes = 0;
    this.phase = 'probe';
    this.currentLabel = 'Сканирование ресурсов...';
    this.emit();
  }

  setTotalBytes(bytes: number): void {
    this.totalBytes = Math.max(0, bytes);
    this.phase = 'loading';
    this.emit();
  }

  startFile(url: string, label: string, kind: AssetKind): void {
    if (this.completed.has(url)) return;
    this.inFlight.set(url, { label, kind, loaded: 0, total: 0 });
    this.currentLabel = label;
    this.currentKind = kind;
    this.currentFileLoaded = 0;
    this.currentFileTotal = 0;
    this.emit();
  }

  reportFileBytes(url: string, loaded: number, total = 0): void {
    const entry = this.inFlight.get(url);
    if (!entry) return;

    const prev = entry.loaded;
    entry.loaded = loaded;
    if (total > 0) entry.total = total;
    this.loadedBytes += Math.max(0, loaded - prev);

    this.currentLabel = entry.label;
    this.currentKind = entry.kind;
    this.currentFileLoaded = loaded;
    this.currentFileTotal = entry.total;
    this.emit();
  }

  completeFile(url: string, bytes?: number): void {
    const entry = this.inFlight.get(url);
    if (entry) {
      if (bytes != null && bytes > entry.loaded) {
        this.loadedBytes += bytes - entry.loaded;
        entry.loaded = bytes;
      }
      this.inFlight.delete(url);
    }
    if (!this.completed.has(url)) {
      this.completed.add(url);
    }
    this.emit();
  }

  setPhase(phase: LoadProgressSnapshot['phase'], label?: string): void {
    this.phase = phase;
    if (label) this.currentLabel = label;
    this.emit();
  }

  snapshot(): LoadProgressSnapshot {
    const modelFiles = this.manifest.filter(a => a.kind === 'model').length;
    const textureFiles = this.manifest.filter(a => a.kind === 'texture').length;
    const completedFiles = this.completed.size;

    let percent = 0;
    if (this.phase === 'done') {
      percent = 100;
    } else if (this.totalBytes > 0) {
      percent = Math.round(clamp01(this.loadedBytes / this.totalBytes) * 100);
    } else if (this.manifest.length > 0) {
      percent = Math.round(clamp01(completedFiles / this.manifest.length) * 100);
    }

    return {
      totalFiles: this.manifest.length,
      completedFiles,
      modelFiles,
      textureFiles,
      totalBytes: this.totalBytes,
      loadedBytes: this.loadedBytes,
      currentLabel: this.currentLabel,
      currentKind: this.currentKind,
      currentFileLoaded: this.currentFileLoaded,
      currentFileTotal: this.currentFileTotal,
      phase: this.phase,
      percent,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }
}

export const loadProgress = new LoadProgress();