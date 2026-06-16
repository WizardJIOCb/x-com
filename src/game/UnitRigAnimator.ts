import * as THREE from 'three';

interface RigState {
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  death: THREE.AnimationAction | null;
  walking: boolean;
  dying: boolean;
}

function pickClip(clips: THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip | null {
  return clips.find(c => pattern.test(c.name)) ?? null;
}

export class UnitRigAnimator {
  private rigs = new Map<string, RigState>();

  bind(unitId: string, root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.unbind(unitId);
    if (clips.length === 0) return;

    const mixer = new THREE.AnimationMixer(root);
    const walkClip = pickClip(clips, /walk/i);
    const deathClip = pickClip(clips, /death/i);

    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    const death = deathClip ? mixer.clipAction(deathClip) : null;

    if (walk) {
      walk.setLoop(THREE.LoopRepeat, Infinity);
      walk.enabled = true;
    }
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
    }

    this.rigs.set(unitId, { mixer, walk, death, walking: false, dying: false });
  }

  unbind(unitId: string): void {
    const rig = this.rigs.get(unitId);
    if (!rig) return;
    rig.mixer.stopAllAction();
    this.rigs.delete(unitId);
  }

  setWalking(unitId: string, walking: boolean): void {
    const rig = this.rigs.get(unitId);
    if (!rig?.walk || rig.dying) return;

    if (walking === rig.walking) return;
    rig.walking = walking;

    if (walking) {
      rig.death?.fadeOut(0.08);
      rig.walk.reset().fadeIn(0.12).play();
      rig.walk.timeScale = 1.15;
    } else {
      rig.walk.fadeOut(0.15);
    }
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
    }
  }

  clear(): void {
    for (const id of [...this.rigs.keys()]) {
      this.unbind(id);
    }
  }
}