import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { MODEL_FLOOR_Y } from './Coords3D';

interface ActiveRagdoll {
  root: THREE.Object3D;
  body: CANNON.Body;
  rootOffset: THREE.Vector3;
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
    this.spawnTumble(mesh, impulse);
  }

  update(dt: number): void {
    const fixed = 1 / 60;
    this.world.step(fixed, dt, 4);

    const toRemove: number[] = [];

    for (let i = 0; i < this.ragdolls.length; i++) {
      const rag = this.ragdolls[i];
      rag.age += dt;

      this.syncTumble(rag);

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
    });
    body.position.set(center.x, center.y, center.z);
    body.quaternion.set(rootWorldQuat.x, rootWorldQuat.y, rootWorldQuat.z, rootWorldQuat.w);
    this.world.addBody(body);
    this.applyImpulse(body, impulse ?? this.randomImpulse(), 6);

    this.ragdolls.push({
      root: mesh,
      body,
      rootOffset,
      age: 0,
      lifetime: 4.5,
    });
  }

  private syncTumble(rag: ActiveRagdoll): void {
    const body = rag.body;
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
    this.world.removeBody(rag.body);

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
