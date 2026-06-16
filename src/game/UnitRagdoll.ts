import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { MODEL_FLOOR_Y } from './Coords3D';

interface BoneLink {
  bone: THREE.Bone;
  body: CANNON.Body;
}

interface ActiveRagdoll {
  root: THREE.Object3D;
  skinned: THREE.SkinnedMesh | null;
  links: BoneLink[];
  constraints: CANNON.Constraint[];
  tumbleBody: CANNON.Body | null;
  age: number;
  lifetime: number;
}

export class UnitRagdollManager {
  readonly group = new THREE.Group();
  private world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
  private ragdolls: ActiveRagdoll[] = [];

  constructor() {
    this.world.broadphase = new CANNON.NaiveBroadphase();
    (this.world.solver as CANNON.GSSolver).iterations = 12;

    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.y = MODEL_FLOOR_Y;
    this.world.addBody(ground);
  }

  spawn(mesh: THREE.Group, impulse?: THREE.Vector3): void {
    this.hideUi(mesh);

    const skinned = this.findSkinned(mesh);
    if (skinned?.skeleton) {
      this.spawnSkeletal(mesh, skinned, impulse);
    } else {
      this.spawnTumble(mesh, impulse);
    }
  }

  update(dt: number): void {
    const fixed = 1 / 60;
    this.world.step(fixed, dt, 4);

    const toRemove: number[] = [];

    for (let i = 0; i < this.ragdolls.length; i++) {
      const rag = this.ragdolls[i];
      rag.age += dt;

      if (rag.skinned) {
        this.syncSkeleton(rag);
      } else if (rag.tumbleBody) {
        this.syncTumble(rag);
      }

      const fadeStart = rag.lifetime - 1.2;
      if (rag.age > fadeStart) {
        const t = Math.min(1, (rag.age - fadeStart) / 1.2);
        this.setOpacity(rag.root, 1 - t);
      }

      if (rag.age >= rag.lifetime) {
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.disposeRagdoll(this.ragdolls[toRemove[i]]);
      this.ragdolls.splice(toRemove[i], 1);
    }
  }

  clear(): void {
    while (this.ragdolls.length > 0) {
      this.disposeRagdoll(this.ragdolls.pop()!);
    }
  }

  private spawnSkeletal(
    mesh: THREE.Group,
    skinned: THREE.SkinnedMesh,
    impulse?: THREE.Vector3
  ): void {
    mesh.updateMatrixWorld(true);
    const bones = skinned.skeleton.bones;
    const boneToBody = new Map<THREE.Bone, CANNON.Body>();
    const links: BoneLink[] = [];
    const constraints: CANNON.Constraint[] = [];

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const childPos = new THREE.Vector3();
    const parentPos = new THREE.Vector3();

    for (const bone of bones) {
      bone.getWorldPosition(worldPos);
      bone.getWorldQuaternion(worldQuat);

      const radius = this.boneRadius(bone, bones);
      const mass = bone.parent instanceof THREE.Bone ? radius * 6 : radius * 12;
      const body = new CANNON.Body({
        mass,
        shape: new CANNON.Sphere(radius),
        linearDamping: 0.25,
        angularDamping: 0.45,
      });
      body.position.set(worldPos.x, worldPos.y, worldPos.z);
      body.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);

      this.world.addBody(body);
      boneToBody.set(bone, body);
      links.push({ bone, body });
    }

    for (const bone of bones) {
      if (!(bone.parent instanceof THREE.Bone)) continue;
      const parentBody = boneToBody.get(bone.parent);
      const childBody = boneToBody.get(bone);
      if (!parentBody || !childBody) continue;

      bone.getWorldPosition(childPos);
      bone.parent.getWorldPosition(parentPos);
      const dist = Math.max(0.04, childPos.distanceTo(parentPos));

      const constraint = new CANNON.DistanceConstraint(parentBody, childBody, dist);
      this.world.addConstraint(constraint);
      constraints.push(constraint);
    }

    const impulseDir = impulse ?? this.randomImpulse();
    const torso = bones[Math.floor(bones.length * 0.45)] ?? bones[0];
    const torsoBody = boneToBody.get(torso);
    if (torsoBody) {
      this.applyImpulse(torsoBody, impulseDir, 5);
    }

    this.ragdolls.push({
      root: mesh,
      skinned,
      links,
      constraints,
      tumbleBody: null,
      age: 0,
      lifetime: 5.5,
    });
  }

  private spawnTumble(mesh: THREE.Group, impulse?: THREE.Vector3): void {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const hx = Math.max(0.08, size.x * 0.5);
    const hy = Math.max(0.12, size.y * 0.5);
    const hz = Math.max(0.08, size.z * 0.5);

    const body = new CANNON.Body({
      mass: 6,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      linearDamping: 0.35,
      angularDamping: 0.55,
    });
    body.position.set(center.x, center.y, center.z);
    this.world.addBody(body);
    this.applyImpulse(body, impulse ?? this.randomImpulse(), 6);

    this.ragdolls.push({
      root: mesh,
      skinned: null,
      links: [],
      constraints: [],
      tumbleBody: body,
      age: 0,
      lifetime: 4.5,
    });
  }

  private syncSkeleton(rag: ActiveRagdoll): void {
    if (!rag.skinned) return;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const parentQuat = new THREE.Quaternion();
    const parentInv = new THREE.Matrix4();

    for (const { bone, body } of rag.links) {
      pos.set(body.position.x, body.position.y, body.position.z);
      quat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);

      if (bone.parent) {
        bone.parent.updateMatrixWorld(true);
        bone.parent.getWorldQuaternion(parentQuat);
        parentInv.copy(bone.parent.matrixWorld).invert();
        pos.applyMatrix4(parentInv);
        quat.premultiply(parentQuat.invert());
      }

      bone.position.copy(pos);
      bone.quaternion.copy(quat);
      bone.updateMatrixWorld(true);
    }

    rag.skinned.skeleton.update();
  }

  private syncTumble(rag: ActiveRagdoll): void {
    const body = rag.tumbleBody;
    if (!body) return;

    rag.root.position.set(body.position.x, body.position.y - MODEL_FLOOR_Y * 0.5, body.position.z);
    rag.root.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    rag.root.updateMatrixWorld(true);
  }

  private applyImpulse(body: CANNON.Body, dir: THREE.Vector3, strength: number): void {
    body.applyImpulse(
      new CANNON.Vec3(dir.x * strength, dir.y * strength * 0.6 + 2.5, dir.z * strength),
      new CANNON.Vec3(0, 0.15, 0)
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 9
    );
  }

  private randomImpulse(): THREE.Vector3 {
    return new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0.4 + Math.random() * 0.4,
      (Math.random() - 0.5) * 2
    ).normalize();
  }

  private boneRadius(bone: THREE.Bone, bones: THREE.Bone[]): number {
    const idx = bones.indexOf(bone);
    let minDist = 0.14;
    for (let i = 0; i < bones.length; i++) {
      if (bones[i].parent !== bone) continue;
      const d = bone.position.distanceTo(bones[i].position);
      if (d > 0.01) minDist = Math.min(minDist, d * 0.45);
    }
    const name = bone.name.toLowerCase();
    if (name.includes('head')) return Math.max(0.1, minDist);
    if (name.includes('hand') || name.includes('foot')) return Math.max(0.05, minDist * 0.7);
    if (idx < 3) return Math.max(0.12, minDist);
    return Math.max(0.06, minDist);
  }

  private findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
    let found: THREE.SkinnedMesh | null = null;
    root.traverse(child => {
      if (child instanceof THREE.SkinnedMesh && child.skeleton) found = child;
    });
    return found;
  }

  private hideUi(mesh: THREE.Group): void {
    for (const name of ['hpBar', 'selectionRing', 'overwatchRing']) {
      const obj = mesh.getObjectByName(name);
      if (obj) obj.visible = false;
    }
  }

  private setOpacity(root: THREE.Object3D, opacity: number): void {
    root.traverse(child => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!(mat instanceof THREE.Material)) continue;
        mat.transparent = true;
        mat.opacity = opacity;
      }
    });
  }

  private disposeRagdoll(rag: ActiveRagdoll): void {
    for (const c of rag.constraints) this.world.removeConstraint(c);
    for (const { body } of rag.links) this.world.removeBody(body);
    if (rag.tumbleBody) this.world.removeBody(rag.tumbleBody);

    rag.root.parent?.remove(rag.root);
    rag.root.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}