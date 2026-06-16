import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID_H, GRID_W } from './Grid';

const PAN_DRAG_THRESHOLD = 5;
const KEY_PAN_SPEED = 28;
const MOUSE_PAN_SCALE = 0.035;

export class CameraInput {
  private keys = new Set<string>();
  private pointerDown = { x: 0, y: 0 };
  private lastPan = { x: 0, y: 0 };
  isPanning = false;
  wasDragging = false;

  private panRight = new THREE.Vector3();
  private panForward = new THREE.Vector3();
  private moveDir = new THREE.Vector3();
  private offset = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private canvas: HTMLCanvasElement
  ) {
    this.bindKeyboard();
    this.bindPointer();
  }

  private bindKeyboard(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'ц', 'ф', 'ы', 'в'].includes(key)) {
        this.keys.add(this.normalizeKey(key));
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(this.normalizeKey(e.key.toLowerCase()));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  private normalizeKey(key: string): string {
    const map: Record<string, string> = { 'ц': 'w', 'ф': 'a', 'ы': 's', 'в': 'd' };
    return map[key] ?? key;
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || target.isContentEditable;
  }

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.pointerDown = { x: e.clientX, y: e.clientY };
      this.lastPan = { x: e.clientX, y: e.clientY };
      this.isPanning = false;
      this.wasDragging = false;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.buttons !== 1) return;

      const dx = e.clientX - this.pointerDown.x;
      const dy = e.clientY - this.pointerDown.y;

      if (!this.isPanning && Math.hypot(dx, dy) > PAN_DRAG_THRESHOLD) {
        this.isPanning = true;
        this.wasDragging = true;
        this.canvas.style.cursor = 'grabbing';
      }

      if (this.isPanning) {
        const deltaX = e.clientX - this.lastPan.x;
        const deltaY = e.clientY - this.lastPan.y;
        this.panByScreenDelta(deltaX, deltaY);
        this.lastPan = { x: e.clientX, y: e.clientY };
      }
    });

    const endPan = () => {
      this.isPanning = false;
      this.canvas.style.cursor = 'crosshair';
    };
    this.canvas.addEventListener('pointerup', endPan);
    this.canvas.addEventListener('pointerleave', endPan);
  }

  update(dt: number): void {
    if (this.keys.size === 0) return;

    this.getGroundAxes(this.panForward, this.panRight);
    this.moveDir.set(0, 0, 0);

    if (this.keys.has('w')) this.moveDir.add(this.panForward);
    if (this.keys.has('s')) this.moveDir.sub(this.panForward);
    if (this.keys.has('a')) this.moveDir.sub(this.panRight);
    if (this.keys.has('d')) this.moveDir.add(this.panRight);

    if (this.moveDir.lengthSq() > 0) {
      this.moveDir.normalize().multiplyScalar(KEY_PAN_SPEED * dt);
      this.applyPan(this.moveDir);
    }
  }

  panByScreenDelta(dx: number, dy: number): void {
    this.getGroundAxes(this.panForward, this.panRight);
    const scale = MOUSE_PAN_SCALE * (this.camera.position.y * 0.04 + 0.5);

    this.offset.set(0, 0, 0);
    this.offset.addScaledVector(this.panRight, -dx * scale);
    this.offset.addScaledVector(this.panForward, dy * scale);
    this.applyPan(this.offset);
  }

  private getGroundAxes(forward: THREE.Vector3, right: THREE.Vector3): void {
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  }

  private applyPan(offset: THREE.Vector3): void {
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    this.clampToMap();
  }

  private clampToMap(): void {
    const margin = 4;
    const maxX = GRID_W / 2 - margin;
    const maxZ = GRID_H / 2 - margin;

    const clampedX = THREE.MathUtils.clamp(this.controls.target.x, -maxX, maxX);
    const clampedZ = THREE.MathUtils.clamp(this.controls.target.z, -maxZ, maxZ);
    const dx = clampedX - this.controls.target.x;
    const dz = clampedZ - this.controls.target.z;

    if (dx !== 0 || dz !== 0) {
      this.controls.target.x += dx;
      this.controls.target.z += dz;
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
  }

  consumeClick(): boolean {
    return !this.wasDragging;
  }

  resetClickState(): void {
    this.wasDragging = false;
  }
}