import * as THREE from 'three';

interface RigState {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  death: THREE.AnimationAction | null;
  walking: boolean;
  dying: boolean;
  walkFade: number;
  walkClock: number;
  baseRootY: number;
  legRig: LegRig | null;
}

interface LegRig {
  thighL: THREE.Bone | null;
  thighR: THREE.Bone | null;
  calfL: THREE.Bone | null;
  calfR: THREE.Bone | null;
  footL: THREE.Bone | null;
  footR: THREE.Bone | null;
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
      walk.clampWhenFinished = false;
      walk.weight = 0;
    }
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
    }

    this.rigs.set(unitId, {
      root,
      mixer,
      walk,
      death,
      walking: false,
      dying: false,
      walkFade: 0.12,
      walkClock: 0,
      baseRootY: root.position.y,
      legRig: this.findLegRig(root),
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
    if (!rig?.walk || rig.dying) return;

    rig.walk.timeScale = THREE.MathUtils.clamp(timeScale, 0.65, 2.4);

    if (walking === rig.walking) return;
    rig.walking = walking;

    if (walking) {
      rig.death?.fadeOut(0.08);
      rig.walk.enabled = true;
      rig.walk.reset().setEffectiveWeight(1).fadeIn(rig.walkFade).play();
    } else {
      rig.walk.fadeOut(0.18);
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
      this.updateProceduralWalk(rig, dt);
    }
  }

  clear(): void {
    for (const id of [...this.rigs.keys()]) {
      this.unbind(id);
    }
  }

  private findLegRig(root: THREE.Object3D): LegRig | null {
    const rig: LegRig = {
      thighL: this.findBone(root, ['thigh_l', 'upperleg_l', 'leg_l']),
      thighR: this.findBone(root, ['thigh_r', 'upperleg_r', 'leg_r']),
      calfL: this.findBone(root, ['calf_l', 'lowerleg_l', 'shin_l']),
      calfR: this.findBone(root, ['calf_r', 'lowerleg_r', 'shin_r']),
      footL: this.findBone(root, ['foot_l']),
      footR: this.findBone(root, ['foot_r']),
    };

    return rig.thighL || rig.thighR || rig.calfL || rig.calfR ? rig : null;
  }

  private findBone(root: THREE.Object3D, names: string[]): THREE.Bone | null {
    const wanted = new Set(names.map(name => name.toLowerCase()));
    let found: THREE.Bone | null = null;

    root.traverse(child => {
      if (found || !(child instanceof THREE.Bone)) return;
      if (wanted.has(child.name.toLowerCase())) found = child;
    });

    return found;
  }

  private updateProceduralWalk(rig: RigState, dt: number): void {
    if (!rig.legRig) return;

    if (rig.walking && !rig.dying) {
      rig.walkClock += dt * 1.75;
      const phase = rig.walkClock * Math.PI * 2;
      const stride = Math.sin(phase);
      const liftL = Math.max(0, Math.sin(phase + Math.PI * 0.35));
      const liftR = Math.max(0, Math.sin(phase + Math.PI * 1.35));
      const bob = Math.abs(Math.sin(phase)) * 0.035;

      this.applyLegPose(rig.legRig.thighL, stride * 0.55);
      this.applyLegPose(rig.legRig.thighR, -stride * 0.55);
      this.applyLegPose(rig.legRig.calfL, liftL * 0.72);
      this.applyLegPose(rig.legRig.calfR, liftR * 0.72);
      this.applyLegPose(rig.legRig.footL, -stride * 0.22 - liftL * 0.28);
      this.applyLegPose(rig.legRig.footR, stride * 0.22 - liftR * 0.28);

      rig.root.position.y = rig.baseRootY + bob;
    } else {
      rig.root.position.y = rig.baseRootY;
    }
  }

  private applyLegPose(bone: THREE.Bone | null, rotateZ: number): void {
    if (!bone) return;
    bone.rotation.z += rotateZ;
  }
}
