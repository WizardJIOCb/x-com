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
  body: CANNON.Body | null;
  rootOffset: THREE.Vector3;
  age: number;
  lifetime: number;
}

const RAGDOLL_GROUP = 2;
const GROUND_GROUP = 1;

export class UnitRagdollManager {
  readonly group = new THREE.Group();
  private world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  private ragdolls: ActiveRagdoll[] = [];

  constructor() {
    this.world.broadphase = new CANNON.NaiveBroadphase();
    (this.world.solver as CANNON.GSSolver).iterations = 24;

    const ground = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      collisionFilterGroup: GROUND_GROUP,
      collisionFilterMask: -1,
    });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.y = MODEL_FLOOR_Y;
    this.world.addBody(ground);
  }

  spawn(mesh: THREE.Group, impulse?: THREE.Vector3): void {
    this.hideUi(mesh);
    this.clearFlash(mesh);

    const skinned = this.findVisibleSkinned(mesh);
    if (skinned?.skeleton?.bones.length) {
      this.spawnSkeletal(mesh, skinned, impulse);
    } else {
      this.spawnTumble(mesh, impulse);
    }
  }

  update(dt: number): void {
    const fixed = 1 / 60;
    this.world.step(fixed, dt, 5);

    const toRemove: number[] = [];

    for (let i = 0; i < this.ragdolls.length; i++) {
      const rag = this.ragdolls[i];
      rag.age += dt;

      if (rag.skinned) this.syncSkeleton(rag);
      else this.syncTumble(rag);

      const fadeStart = rag.lifetime - 1.2;
      if (rag.age > fadeStart) {
        const t = Math.min(1, (rag.age - fadeStart) / 1.2);
        this.setOpacity(rag.root, 1 - t);
      }

      if (rag.age >= rag.lifetime) toRemove.push(i);
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
    skinned.skeleton.update();

    const links: BoneLink[] = [];
    const constraints: CANNON.Constraint[] = [];
    const boneToBody = new Map<THREE.Bone, CANNON.Body>();
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();

    for (const bone of skinned.skeleton.bones) {
      bone.getWorldPosition(worldPos);
      bone.getWorldQuaternion(worldQuat);

      const body = new CANNON.Body({
        mass: bone.parent instanceof THREE.Bone ? this.boneMass(bone) : 1.2,
        shape: new CANNON.Sphere(this.boneRadius(bone)),
        linearDamping: 0.62,
        angularDamping: 0.78,
        collisionFilterGroup: RAGDOLL_GROUP,
        collisionFilterMask: GROUND_GROUP,
      });
      body.position.set(worldPos.x, worldPos.y, worldPos.z);
      body.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);

      this.world.addBody(body);
      boneToBody.set(bone, body);
      links.push({ bone, body });
    }

    for (const bone of skinned.skeleton.bones) {
      if (!(bone.parent instanceof THREE.Bone)) continue;
      const body = boneToBody.get(bone);
      const parentBody = boneToBody.get(bone.parent);
      if (!body || !parentBody) continue;

      bone.getWorldPosition(worldPos);
      const joint = new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z);
      const pivotA = parentBody.pointToLocalFrame(joint);
      const pivotB = body.pointToLocalFrame(joint);
      const constraint = new CANNON.PointToPointConstraint(
        parentBody,
        pivotA,
        body,
        pivotB,
        1e5
      );
      constraint.collideConnected = false;
      this.world.addConstraint(constraint);
      constraints.push(constraint);
    }

    const impulseDir = impulse ?? this.randomImpulse();
    const pelvis =
      links.find(link => /pelvis|hips|spine/i.test(link.bone.name)) ??
      links[Math.floor(links.length * 0.35)] ??
      links[0];
    if (pelvis) this.applyImpulse(pelvis.body, impulseDir, 4.2);

    this.ragdolls.push({
      root: mesh,
      skinned,
      links,
      constraints,
      body: null,
      rootOffset: new THREE.Vector3(),
      age: 0,
      lifetime: 5.5,
    });
  }

  private spawnTumble(mesh: THREE.Group, impulse?: THREE.Vector3): void {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const rootWorldPos = new THREE.Vector3();
    const rootWorldQuat = new THREE.Quaternion();
    box.getSize(size);
    box.getCenter(center);
    mesh.getWorldPosition(rootWorldPos);
    mesh.getWorldQuaternion(rootWorldQuat);

    const hx = Math.max(0.08, size.x * 0.5);
    const hy = Math.max(0.12, size.y * 0.5);
    const hz = Math.max(0.08, size.z * 0.5);
    const invRootQuat = rootWorldQuat.clone().invert();
    const rootOffset = rootWorldPos.clone().sub(center).applyQuaternion(invRootQuat);

    const body = new CANNON.Body({
      mass: 6,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      linearDamping: 0.35,
      angularDamping: 0.55,
      collisionFilterGroup: RAGDOLL_GROUP,
      collisionFilterMask: GROUND_GROUP,
    });
    body.position.set(center.x, center.y, center.z);
    body.quaternion.set(rootWorldQuat.x, rootWorldQuat.y, rootWorldQuat.z, rootWorldQuat.w);
    this.world.addBody(body);
    this.applyImpulse(body, impulse ?? this.randomImpulse(), 6);

    this.ragdolls.push({
      root: mesh,
      skinned: null,
      links: [],
      constraints: [],
      body,
      rootOffset,
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
    const body = rag.body;
    if (!body) return;

    const quat = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    const offset = rag.rootOffset.clone().applyQuaternion(quat);

    rag.root.position.set(
      body.position.x + offset.x,
      body.position.y + offset.y,
      body.position.z + offset.z
    );
    rag.root.quaternion.copy(quat);
    rag.root.updateMatrixWorld(true);
  }

  private applyImpulse(body: CANNON.Body, dir: THREE.Vector3, strength: number): void {
    body.applyImpulse(
      new CANNON.Vec3(dir.x * strength, dir.y * strength * 0.45 + 1.4, dir.z * strength),
      new CANNON.Vec3(0, 0.12, 0)
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 4.5,
      (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * 4.5
    );
  }

  private randomImpulse(): THREE.Vector3 {
    return new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0.3 + Math.random() * 0.35,
      (Math.random() - 0.5) * 2
    ).normalize();
  }

  private boneRadius(bone: THREE.Bone): number {
    const name = bone.name.toLowerCase();
    if (name.includes('head')) return 0.12;
    if (name.includes('pelvis') || name.includes('spine')) return 0.13;
    if (name.includes('thigh') || name.includes('upperarm')) return 0.08;
    if (name.includes('calf') || name.includes('lowerarm')) return 0.07;
    if (name.includes('hand') || name.includes('foot')) return 0.055;
    return 0.075;
  }

  private boneMass(bone: THREE.Bone): number {
    const name = bone.name.toLowerCase();
    if (name.includes('pelvis') || name.includes('spine')) return 0.9;
    if (name.includes('head')) return 0.45;
    if (name.includes('thigh')) return 0.42;
    if (name.includes('calf')) return 0.34;
    if (name.includes('upperarm')) return 0.26;
    if (name.includes('lowerarm')) return 0.2;
    return 0.16;
  }

  private findVisibleSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
    let found: THREE.SkinnedMesh | null = null;
    root.traverse(child => {
      if (found || !(child instanceof THREE.SkinnedMesh) || !child.skeleton) return;
      if (this.isVisibleInTree(child)) found = child;
    });
    return found;
  }

  private isVisibleInTree(object: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = object;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  private hideUi(mesh: THREE.Group): void {
    for (const name of ['hpBar', 'selectionRing', 'overwatchRing']) {
      const obj = mesh.getObjectByName(name);
      if (obj) obj.visible = false;
    }
  }

  private clearFlash(root: THREE.Object3D): void {
    root.traverse(child => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mat.needsUpdate = true;
      }
    });
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
    for (const constraint of rag.constraints) this.world.removeConstraint(constraint);
    for (const { body } of rag.links) this.world.removeBody(body);
    if (rag.body) this.world.removeBody(rag.body);

    rag.root.parent?.remove(rag.root);
    rag.root.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}
