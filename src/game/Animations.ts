import * as THREE from 'three';
import type { Position, ShotRayHit, Unit } from '../types';
import { gridToWorld, movementYaw } from './Coords3D';
import { UnitRagdollManager } from './UnitRagdoll';
import { UnitRigAnimator } from './UnitRigAnimator';

export interface UnitVisual {
  x: number;
  y: number;
  flash: number;
  hitShake: number;
  deathProgress: number;
  aimAngle: number;
  spawnPulse: number;
  ragdollActive: boolean;
  rigActive: boolean;
}

export interface Particle3D {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  shrink: boolean;
}

export interface Tracer3D {
  line: THREE.Line;
  from: THREE.Vector3;
  to: THREE.Vector3;
  progress: number;
  speed: number;
  hit: boolean;
  crit: boolean;
}

export interface FloatingLabel {
  element: HTMLDivElement;
  object: THREE.Object3D;
  life: number;
  maxLife: number;
}

export class AnimationManager {
  unitVisuals = new Map<string, UnitVisual>();
  particles: Particle3D[] = [];
  tracers: Tracer3D[] = [];
  floatingLabels: FloatingLabel[] = [];
  effectsGroup = new THREE.Group();
  screenShake = 0;
  time = 0;
  overwatchPulse = 0;
  grenadeMesh: THREE.Mesh | null = null;
  labelContainer: HTMLElement | null = null;

  private particleGeo = new THREE.SphereGeometry(0.06, 6, 4);
  private tracerMat = new THREE.LineBasicMaterial({ transparent: true });
  private rigAnimator = new UnitRigAnimator();
  readonly ragdollManager = new UnitRagdollManager();

  /** Поставщик меша юнита — задаёт Renderer3D для ragdoll при смерти */
  meshProvider: ((unitId: string) => THREE.Group | null) | null = null;
  /** Вызывается после переноса меша в ragdoll — Renderer убирает из unitMeshes */
  onRagdollDetach: ((unitId: string) => void) | null = null;

  syncUnits(units: Unit[]): void {
    for (const unit of units) {
      if (!this.unitVisuals.has(unit.id)) {
        this.unitVisuals.set(unit.id, {
          x: unit.position.x,
          y: unit.position.y,
          flash: 0,
          hitShake: 0,
          deathProgress: unit.isAlive ? 0 : 1,
          aimAngle: 0,
          spawnPulse: 1,
          ragdollActive: false,
          rigActive: false,
        });
      } else if (unit.isAlive) {
        const v = this.unitVisuals.get(unit.id)!;
        if (v.deathProgress === 0 &&
            Math.abs(v.x - unit.position.x) < 0.01 &&
            Math.abs(v.y - unit.position.y) < 0.01) {
          v.x = unit.position.x;
          v.y = unit.position.y;
        }
      }
    }
  }

  getVisual(unitId: string): UnitVisual | undefined {
    return this.unitVisuals.get(unitId);
  }

  bindUnitRig(unitId: string, root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.rigAnimator.bind(unitId, root, clips);
  }

  unbindUnitRig(unitId: string): void {
    this.rigAnimator.unbind(unitId);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 3);
    this.overwatchPulse = (Math.sin(this.time * 3) + 1) / 2;

    for (const v of this.unitVisuals.values()) {
      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 4);
      if (v.hitShake > 0) v.hitShake = Math.max(0, v.hitShake - dt * 5);
      if (v.spawnPulse < 1) v.spawnPulse = Math.min(1, v.spawnPulse + dt * 2);
    }

    this.rigAnimator.update(dt);
    this.ragdollManager.update(dt);

    this.particles = this.particles.filter(p => {
      p.life -= dt;
      p.velocity.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const alpha = p.life / p.maxLife;
      const scale = p.shrink ? alpha : 1;
      p.mesh.scale.setScalar(scale);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
      if (p.life <= 0) {
        this.effectsGroup.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        p.mesh.geometry.dispose();
      }
      return p.life > 0;
    });

    this.tracers = this.tracers.filter(t => {
      t.progress += t.speed * dt;
      const p = Math.min(1, t.progress);
      const pos = new THREE.Vector3().lerpVectors(t.from, t.to, p);
      const geo = t.line.geometry as THREE.BufferGeometry;
      const arr = geo.attributes.position as THREE.BufferAttribute;
      arr.setXYZ(1, pos.x, pos.y, pos.z);
      arr.needsUpdate = true;
      (t.line.material as THREE.LineBasicMaterial).opacity = 1 - p * 0.6;
      if (t.progress >= 1.2) {
        this.effectsGroup.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });

    this.floatingLabels = this.floatingLabels.filter(l => {
      l.life -= dt;
      l.object.position.y += dt * 1.5;
      const alpha = l.life / l.maxLife;
      l.element.style.opacity = String(alpha);
      if (l.life <= 0) {
        l.element.remove();
        return false;
      }
      return true;
    });
  }

  async animateMove(unit: Unit, path: Position[]): Promise<void> {
    const visual = this.unitVisuals.get(unit.id)!;
    const stepDuration = 320;
    const walking = path.length > 1;

    if (walking) {
      visual.rigActive = true;
      const walkTimeScale = this.rigAnimator.getWalkTimeScale(unit.id, stepDuration);
      this.rigAnimator.setWalking(unit.id, true, walkTimeScale);
    }

    try {
      for (let i = 1; i < path.length; i++) {
        const from = path[i - 1];
        const to = path[i];
        const start = performance.now();

        await new Promise<void>(resolve => {
          const tick = () => {
            const elapsed = performance.now() - start;
            const t = Math.min(1, elapsed / stepDuration);
            const eased = easeInOutQuad(t);
            visual.x = from.x + (to.x - from.x) * eased;
            visual.y = from.y + (to.y - from.y) * eased;
            visual.aimAngle = movementYaw(to.x - from.x, to.y - from.y);

            if (t >= 1) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }

      const end = path[path.length - 1];
      visual.x = end.x;
      visual.y = end.y;
    } finally {
      if (walking) {
        this.rigAnimator.setWalking(unit.id, false);
        visual.rigActive = false;
      }
    }
  }

  playShotToTile(
    shooter: Unit,
    endPos: Position,
    hits: ShotRayHit[]
  ): Promise<void> {
    const sv = this.unitVisuals.get(shooter.id)!;
    const from = gridToWorld(sv.x, sv.y, 0.7);
    const to = gridToWorld(endPos.x, endPos.y, 0.7);

    sv.aimAngle = movementYaw(
      endPos.x - shooter.position.x,
      endPos.y - shooter.position.y
    );

    const color = shooter.team === 'soldier' ? 0x7ee8ff : 0xc86eff;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
    const lineMat = this.tracerMat.clone();
    lineMat.color.setHex(color);
    lineMat.linewidth = 2;
    const line = new THREE.Line(lineGeo, lineMat);
    this.effectsGroup.add(line);

    this.tracers.push({ line, from, to, progress: 0, speed: 2.8, hit: hits.length > 0, crit: false });
    this.spawnBurst(from, color, 5, 0.15);

    const totalDist = Math.hypot(endPos.x - shooter.position.x, endPos.y - shooter.position.y);
    const delays: { ms: number; fn: () => void }[] = [];

    for (const hit of hits) {
      const d = Math.hypot(hit.position.x - shooter.position.x, hit.position.y - shooter.position.y);
      const ms = totalDist > 0 ? Math.round((d / totalDist) * 280) : 0;
      const worldPos = gridToWorld(hit.position.x, hit.position.y, 0.7);

      if (hit.kind === 'unit' && hit.unit && hit.shotResult) {
        const tv = this.unitVisuals.get(hit.unit.id);
        const labelPos = gridToWorld(hit.position.x, hit.position.y, 1.2);
        if (hit.shotResult.hit) {
          delays.push({
            ms,
            fn: () => {
              this.spawnBurst(worldPos, hit.shotResult!.crit ? 0xff2d55 : 0xff8844, hit.shotResult!.crit ? 16 : 10, 0.35);
              if (tv) {
                tv.flash = 1;
                tv.hitShake = 1;
              }
              this.addLabel(
                labelPos,
                `-${hit.shotResult!.damage}`,
                hit.shotResult!.crit ? '#ff2d55' : '#ff6b35',
                hit.shotResult!.crit ? 1.4 : 1
              );
              if (hit.shotResult!.crit) this.screenShake = 0.8;
            },
          });
        } else {
          delays.push({
            ms,
            fn: () => {
              this.spawnBurst(worldPos, 0x667788, 4, 0.2);
              this.addLabel(labelPos, 'MISS', '#8899aa', 0.9);
            },
          });
        }
      } else if (hit.tileDamage > 0) {
        delays.push({
          ms,
          fn: () => {
            this.spawnBurst(worldPos, 0xffa502, 12, 0.3);
            this.addLabel(gridToWorld(hit.position.x, hit.position.y, 1.0), '💥', '#ffa502', 0.9);
          },
        });
      } else if (hit.kind === 'wall') {
        delays.push({
          ms,
          fn: () => {
            this.spawnBurst(worldPos, 0x8899aa, 8, 0.25);
          },
        });
      }
    }

    return new Promise(resolve => {
      for (const { ms, fn } of delays) {
        setTimeout(fn, ms);
      }
      setTimeout(resolve, 380);
    });
  }

  playShot(
    shooter: Unit,
    target: Unit,
    hit: boolean,
    crit: boolean,
    damage: number
  ): Promise<void> {
    const sv = this.unitVisuals.get(shooter.id)!;
    const tv = this.unitVisuals.get(target.id)!;
    const from = gridToWorld(sv.x, sv.y, 0.7);
    const to = gridToWorld(tv.x, tv.y, 0.7);

    sv.aimAngle = movementYaw(
      target.position.x - shooter.position.x,
      target.position.y - shooter.position.y
    );

    const color = shooter.team === 'soldier' ? 0x7ee8ff : 0xc86eff;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
    const lineMat = this.tracerMat.clone();
    lineMat.color.setHex(color);
    lineMat.linewidth = crit ? 3 : 2;
    const line = new THREE.Line(lineGeo, lineMat);
    this.effectsGroup.add(line);

    this.tracers.push({ line, from, to, progress: 0, speed: crit ? 3.5 : 2.5, hit, crit });
    this.spawnBurst(from, color, 5, 0.15);

    return new Promise(resolve => {
      setTimeout(() => {
        const targetPos = gridToWorld(tv.x, tv.y, 1.2);
        if (hit) {
          this.spawnBurst(to, crit ? 0xff2d55 : 0xff8844, crit ? 20 : 10, 0.4);
          tv.flash = 1;
          tv.hitShake = 1;
          this.addLabel(targetPos, `-${damage}`, crit ? '#ff2d55' : '#ff6b35', crit ? 1.4 : 1);
          if (crit) this.screenShake = 0.8;
        } else {
          this.spawnBurst(to, 0x667788, 4, 0.2);
          this.addLabel(targetPos, 'MISS', '#8899aa', 0.9);
        }
        resolve();
      }, hit ? 300 : 350);
    });
  }

  playGrenade(from: Position, to: Position): Promise<void> {
    const start = gridToWorld(from.x, from.y, 0.8);
    const end = gridToWorld(to.x, to.y, 0.3);

    if (!this.grenadeMesh) {
      this.grenadeMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x556b2f, metalness: 0.5, roughness: 0.5 })
      );
    }
    this.effectsGroup.add(this.grenadeMesh);

    const duration = 650;
    const startTime = performance.now();

    return new Promise(resolve => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - startTime) / duration);
        const pos = new THREE.Vector3().lerpVectors(start, end, t);
        pos.y += Math.sin(t * Math.PI) * 2.5;
        this.grenadeMesh!.position.copy(pos);
        this.grenadeMesh!.rotation.x += 0.15;
        this.grenadeMesh!.rotation.z += 0.1;

        if (t >= 1) {
          this.effectsGroup.remove(this.grenadeMesh!);
          this.spawnExplosion(end);
          this.screenShake = 1.2;
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  playDeath(unitId: string): Promise<void> {
    const v = this.unitVisuals.get(unitId);
    if (!v) return Promise.resolve();

    this.rigAnimator.playDeath(unitId);
    v.rigActive = true;

    const mesh = this.meshProvider?.(unitId);
    if (mesh) {
      return new Promise(resolve => {
        setTimeout(() => {
          this.rigAnimator.stopForRagdoll(unitId);
          v.ragdollActive = true;
          v.deathProgress = 0;

          const worldPos = mesh.getWorldPosition(new THREE.Vector3());
          mesh.parent?.remove(mesh);
          this.ragdollManager.group.add(mesh);
          mesh.position.copy(worldPos);
          mesh.updateMatrixWorld(true);

          this.onRagdollDetach?.(unitId);
          this.ragdollManager.spawn(mesh);
          resolve();
        }, 180);
      });
    }

    const duration = 600;
    const start = performance.now();

    return new Promise(resolve => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / duration);
        v.deathProgress = easeInOutQuad(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  playOverwatchActivate(unitId: string): void {
    const v = this.unitVisuals.get(unitId);
    if (!v) return;
    v.spawnPulse = 0;
    const center = gridToWorld(v.x, v.y, 0.5);
    this.spawnBurst(center, 0xffa502, 16, 0.5);
  }

  spawnExplosion(center: THREE.Vector3): void {
    const colors = [0xff6b35, 0xff2d55, 0xffa502, 0xffee55, 0xffffff];
    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const elev = Math.random() * Math.PI * 0.5;
      const speed = 2 + Math.random() * 5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * Math.cos(elev) * speed,
        Math.sin(elev) * speed + 2,
        Math.sin(angle) * Math.cos(elev) * speed
      );
      this.addParticle(center.clone(), vel, colors[Math.floor(Math.random() * colors.length)], 0.5 + Math.random() * 0.5, 0.08 + Math.random() * 0.1, true);
    }
    // Smoke
    for (let i = 0; i < 10; i++) {
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.5, 1 + Math.random(), (Math.random() - 0.5) * 0.5);
      this.addParticle(center.clone(), vel, 0x444444, 1 + Math.random(), 0.2 + Math.random() * 0.15, true);
    }
    // Ground scorch ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 1.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x331100, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.16;
    this.effectsGroup.add(ring);
    setTimeout(() => {
      this.effectsGroup.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }, 2000);
  }

  private spawnBurst(center: THREE.Vector3, color: number, count: number, life: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      const vel = new THREE.Vector3(Math.cos(angle) * speed, Math.random() * 3, Math.sin(angle) * speed);
      this.addParticle(center.clone(), vel, color, life, 0.05 + Math.random() * 0.05, true);
    }
  }

  private addParticle(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: number,
    life: number,
    size: number,
    shrink: boolean
  ): void {
    const mesh = new THREE.Mesh(
      this.particleGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(size / 0.06);
    this.effectsGroup.add(mesh);
    this.particles.push({ mesh, velocity: vel, life, maxLife: life, shrink });
  }

  private addLabel(
    worldPos: THREE.Vector3,
    text: string,
    color: string,
    scale: number
  ): void {
    if (!this.labelContainer) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      color: ${color};
      font: bold ${Math.round(18 * scale)}px 'Segoe UI', sans-serif;
      text-shadow: 0 0 8px ${color}, 1px 1px 3px rgba(0,0,0,0.8);
      pointer-events: none;
      user-select: none;
    `;
    this.labelContainer.appendChild(el);

    const obj = new THREE.Object3D();
    obj.position.copy(worldPos);
    this.floatingLabels.push({ element: el, object: obj, life: 1.2, maxLife: 1.2 });
  }

  getFloatingLabelPositions(camera: THREE.Camera, width: number, height: number): void {
    const projected = new THREE.Vector3();
    for (const l of this.floatingLabels) {
      projected.copy(l.object.position);
      projected.project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      l.element.style.position = 'absolute';
      l.element.style.left = `${x}px`;
      l.element.style.top = `${y}px`;
      l.element.style.transform = 'translate(-50%, -50%)';
    }
  }

  clear(): void {
    for (const p of this.particles) {
      this.effectsGroup.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    for (const t of this.tracers) {
      this.effectsGroup.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
    }
    for (const l of this.floatingLabels) l.element.remove();
    this.particles = [];
    this.tracers = [];
    this.floatingLabels = [];
    this.unitVisuals.clear();
    this.rigAnimator.clear();
    this.ragdollManager.clear();
    this.screenShake = 0;
    this.time = 0;
  }
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
