import * as THREE from 'three';

interface RigState {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  death: THREE.AnimationAction | null;
  walking: boolean;
  dying: boolean;
  walkFade: number;
  baseRootY: number;
  bobClock: number;
}

function pickClip(clips: THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip | null {
  return clips.find(c => pattern.test(c.name)) ?? null;
}

export class UnitRigAnimator {
  private rigs = new Map<string, RigState>();

  bind(unitId: string, root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.unbind(unitId);

    const mixer = new THREE.AnimationMixer(root);
    const walkClip = pickClip(clips, /walk/i);
    const deathClip = pickClip(clips, /death/i);

    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    const death = deathClip ? mixer.clipAction(deathClip) : null;

    if (walk) {
      walk.setLoop(THREE.LoopRepeat, Infinity);
      walk.enabled = true;
      walk.clampWhenFinished = false;
      walk.weight = 0;
    }
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
    }

    if (!walk && !death) return;

    this.rigs.set(unitId, {
      root,
      mixer,
      walk,
      death,
      walking: false,
      dying: false,
      walkFade: 0.12,
      baseRootY: root.position.y,
      bobClock: 0,
    });
  }

  unbind(unitId: string): void {
    const rig = this.rigs.get(unitId);
    if (!rig) return;
    rig.mixer.stopAllAction();
    this.rigs.delete(unitId);
  }

  setWalking(unitId: string, walking: boolean, timeScale = 1): void {
    const rig = this.rigs.get(unitId);
    if (!rig || rig.dying) return;

    if (rig.walk) {
      rig.walk.timeScale = THREE.MathUtils.clamp(timeScale, 0.65, 2.4);
    }

    if (walking === rig.walking) return;
    rig.walking = walking;

    if (walking) {
      rig.death?.fadeOut(0.08);
      if (rig.walk) {
        rig.walk.enabled = true;
        rig.walk.reset().setEffectiveWeight(1).fadeIn(rig.walkFade).play();
      }
    } else {
      rig.walk?.fadeOut(0.18);
    }
  }

  getWalkTimeScale(unitId: string, stepDurationMs: number, tilesPerCycle = 1.8): number {
    const rig = this.rigs.get(unitId);
    const clipDuration = rig?.walk?.getClip().duration ?? 0;
    if (clipDuration <= 0 || stepDurationMs <= 0) return 1.4;

    const targetCycleSeconds = (stepDurationMs * tilesPerCycle) / 1000;
    return clipDuration / targetCycleSeconds;
  }

  playDeath(unitId: string): void {
    const rig = this.rigs.get(unitId);
    if (!rig?.death) return;

    rig.dying = true;
    rig.walking = false;
    rig.walk?.fadeOut(0.08);
    rig.death.reset().fadeIn(0.1).play();
  }

  stopForRagdoll(unitId: string): void {
    const rig = this.rigs.get(unitId);
    if (!rig) return;
    rig.mixer.stopAllAction();
    this.rigs.delete(unitId);
  }

  update(dt: number): void {
    for (const rig of this.rigs.values()) {
      rig.mixer.update(dt);
      this.updateWalkBob(rig, dt);
    }
  }

  clear(): void {
    for (const id of [...this.rigs.keys()]) {
      this.unbind(id);
    }
  }

  private updateWalkBob(rig: RigState, dt: number): void {
    if (rig.walking && !rig.dying) {
      rig.bobClock += dt * 1.85;
      const phase = rig.bobClock * Math.PI * 2;
      const bob = Math.abs(Math.sin(phase)) * 0.02;
      rig.root.position.y = rig.baseRootY + bob;
    } else {
      rig.root.position.y = rig.baseRootY;
    }
  }
}
