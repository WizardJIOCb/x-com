import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { MODEL_FLOOR_Y } from './Coords3D';

interface BoneLink {
  bone: THREE.Bone;
  child: THREE.Bone | null;
  body: CANNON.Body;
  bindLocalPosition: THREE.Vector3;
  bindLocalQuaternion: THREE.Quaternion;
  bodyToBoneQuaternion: THREE.Quaternion;
  bindDirection: THREE.Vector3;
  length: number;
  radius: number;
}

interface ProxyLink {
  body: CANNON.Body;
  mesh: THREE.Mesh;
}

export interface RagdollImpulse {
  direction: THREE.Vector3;
  point?: THREE.Vector3;
  strength?: number;
  upward?: number;
}

interface ActiveRagdoll {
  root: THREE.Object3D;
  skinned: THREE.SkinnedMesh | null;
  links: BoneLink[];
  constraints: CANNON.Constraint[];
  body: CANNON.Body | null;
  rootOffset: THREE.Vector3;
  rootBody: CANNON.Body | null;
  rootBindWorldPosition: THREE.Vector3;
  rootBindPosition: THREE.Vector3;
  proxyRoot: THREE.Group | null;
  proxyLinks: ProxyLink[];
  age: number;
  lifetime: number;
}

const RAGDOLL_GROUP = 2;
const GROUND_GROUP = 1;
const RAGDOLL_COLLISION_MASK = GROUND_GROUP | RAGDOLL_GROUP;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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

  spawn(mesh: THREE.Group, impulse?: RagdollImpulse): void {
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

      if (rag.proxyRoot) this.syncProxy(rag);
      else if (rag.skinned) this.syncSkeleton(rag);
      else this.syncTumble(rag);

      const fadeStart = rag.lifetime - 1.2;
      if (rag.age > fadeStart) {
        const t = Math.min(1, (rag.age - fadeStart) / 1.2);
        this.setOpacity(rag.proxyRoot ?? rag.root, 1 - t);
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

  spawnProxyRagdoll(
    mesh: THREE.Group,
    skinned: THREE.SkinnedMesh,
    impulse?: RagdollImpulse
  ): void {
    mesh.updateMatrixWorld(true);
    skinned.skeleton.update();

    const bones = new Map<string, THREE.Bone>();
    for (const bone of skinned.skeleton.bones) bones.set(bone.name.toLowerCase(), bone);

    const material = this.makeProxyMaterial(mesh);
    const proxyRoot = new THREE.Group();
    proxyRoot.name = 'unitRagdollProxy';
    this.group.add(proxyRoot);

    const proxyLinks: ProxyLink[] = [];
    const constraints: CANNON.Constraint[] = [];
    const bodyByName = new Map<string, CANNON.Body>();

    const addSegment = (
      id: string,
      fromName: string,
      toName: string,
      radius: number,
      mass: number,
      kind: 'capsule' | 'box' | 'head' = 'capsule'
    ) => {
      const from = bones.get(fromName);
      const to = bones.get(toName);
      if (!from || !to) return;

      const a = from.getWorldPosition(new THREE.Vector3());
      const b = to.getWorldPosition(new THREE.Vector3());
      const dir = b.clone().sub(a);
      const length = dir.length();
      if (length < 0.035) return;

      const center = a.clone().add(b).multiplyScalar(0.5);
      const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize());
      const halfLen = Math.max(0.025, length * 0.5);
      const shape = new CANNON.Box(new CANNON.Vec3(radius, halfLen, radius));
      const body = new CANNON.Body({
        mass,
        shape,
        linearDamping: 0.34,
        angularDamping: 0.5,
        collisionFilterGroup: RAGDOLL_GROUP,
        collisionFilterMask: RAGDOLL_COLLISION_MASK,
      });
      body.position.set(center.x, center.y, center.z);
      body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      this.world.addBody(body);

      const geometry = kind === 'head'
        ? new THREE.SphereGeometry(radius * 1.2, 10, 8)
        : kind === 'box'
          ? new THREE.BoxGeometry(radius * 2.2, length, radius * 1.6)
          : new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 8);
      const visual = new THREE.Mesh(geometry, material.clone());
      visual.castShadow = true;
      visual.receiveShadow = true;
      proxyRoot.add(visual);

      proxyLinks.push({ body, mesh: visual });
      bodyByName.set(id, body);
    };

    addSegment('torso', 'pelvis', 'spine_02', 0.145, 2.2, 'box');
    addSegment('head', 'neck_01', 'head', 0.105, 0.7, 'head');
    for (const side of ['l', 'r']) {
      addSegment(`upperarm_${side}`, `upperarm_${side}`, `lowerarm_${side}`, 0.055, 0.45);
      addSegment(`lowerarm_${side}`, `lowerarm_${side}`, `hand_${side}`, 0.045, 0.35);
      addSegment(`thigh_${side}`, `thigh_${side}`, `calf_${side}`, 0.07, 0.75);
      addSegment(`calf_${side}`, `calf_${side}`, `foot_${side}`, 0.055, 0.55);
    }
    material.dispose();

    if (proxyLinks.length === 0) {
      proxyRoot.parent?.remove(proxyRoot);
      this.spawnTumble(mesh, impulse);
      return;
    }

    const connect = (aName: string, bName: string, jointBoneName: string, strength = 1.2e5) => {
      const a = bodyByName.get(aName);
      const b = bodyByName.get(bName);
      const jointBone = bones.get(jointBoneName);
      if (!a || !b || !jointBone) return;
      const point = jointBone.getWorldPosition(new THREE.Vector3());
      const joint = new CANNON.Vec3(point.x, point.y, point.z);
      const constraint = new CANNON.PointToPointConstraint(
        a,
        a.pointToLocalFrame(joint),
        b,
        b.pointToLocalFrame(joint),
        strength
      );
      constraint.collideConnected = false;
      this.world.addConstraint(constraint);
      constraints.push(constraint);
    };

    connect('torso', 'head', 'neck_01');
    for (const side of ['l', 'r']) {
      connect('torso', `upperarm_${side}`, `upperarm_${side}`);
      connect(`upperarm_${side}`, `lowerarm_${side}`, `lowerarm_${side}`);
      connect('torso', `thigh_${side}`, `thigh_${side}`, 1.8e5);
      connect(`thigh_${side}`, `calf_${side}`, `calf_${side}`, 1.5e5);
    }

    mesh.visible = false;

    const impulseTarget = impulse?.point
      ? this.closestProxyToPoint(proxyLinks, impulse.point)
      : bodyByName.get('torso') ?? proxyLinks[0]?.body;
    if (impulseTarget) this.applyImpulse(impulseTarget, impulse ?? this.randomImpulse(), 8.5);
    const torso = bodyByName.get('torso');
    if (torso && torso !== impulseTarget) this.applyImpulse(torso, impulse ?? this.randomImpulse(), 2.2);

    this.ragdolls.push({
      root: mesh,
      skinned,
      links: [],
      constraints,
      body: null,
      rootOffset: new THREE.Vector3(),
      rootBody: null,
      rootBindWorldPosition: new THREE.Vector3(),
      rootBindPosition: new THREE.Vector3(),
      proxyRoot,
      proxyLinks,
      age: 0,
      lifetime: 5.5,
    });
  }

  spawnSkeletal(
    mesh: THREE.Group,
    skinned: THREE.SkinnedMesh,
    impulse?: RagdollImpulse
  ): void {
    mesh.updateMatrixWorld(true);
    skinned.skeleton.update();

    const links: BoneLink[] = [];
    const constraints: CANNON.Constraint[] = [];
    const boneToLink = new Map<THREE.Bone, BoneLink>();
    const boneWorldPos = new THREE.Vector3();
    const childWorldPos = new THREE.Vector3();
    const midpoint = new THREE.Vector3();
    const segmentDir = new THREE.Vector3();
    const bodyQuat = new THREE.Quaternion();
    const boneWorldQuat = new THREE.Quaternion();

    for (const bone of skinned.skeleton.bones) {
      const child = this.primaryBoneChild(bone);
      if (!child || !this.isUsefulSegment(bone, child)) continue;

      bone.getWorldPosition(boneWorldPos);
      child.getWorldPosition(childWorldPos);
      segmentDir.subVectors(childWorldPos, boneWorldPos);
      const length = segmentDir.length();
      if (length < 0.035) continue;

      midpoint.copy(boneWorldPos).add(childWorldPos).multiplyScalar(0.5);
      segmentDir.normalize();
      bodyQuat.setFromUnitVectors(Y_AXIS, segmentDir);

      const radius = this.segmentRadius(bone, length);

      const body = new CANNON.Body({
        mass: this.boneMass(bone),
        shape: new CANNON.Box(new CANNON.Vec3(radius, Math.max(0.025, length * 0.48), radius)),
        linearDamping: 0.48,
        angularDamping: 0.64,
        collisionFilterGroup: RAGDOLL_GROUP,
        collisionFilterMask: RAGDOLL_COLLISION_MASK,
      });
      body.position.set(midpoint.x, midpoint.y, midpoint.z);
      body.quaternion.set(bodyQuat.x, bodyQuat.y, bodyQuat.z, bodyQuat.w);

      this.world.addBody(body);
      bone.getWorldQuaternion(boneWorldQuat);

      const link: BoneLink = {
        bone,
        child,
        body,
        bindLocalPosition: bone.position.clone(),
        bindLocalQuaternion: bone.quaternion.clone(),
        bodyToBoneQuaternion: bodyQuat.clone().invert().multiply(boneWorldQuat),
        bindDirection: child.position.lengthSq() > 0.0001
          ? child.position.clone().normalize()
          : new THREE.Vector3(0, 1, 0),
        length,
        radius,
      };
      boneToLink.set(bone, link);
      links.push(link);
    }

    for (const link of links) {
      if (!(link.bone.parent instanceof THREE.Bone)) continue;
      const parentLink = boneToLink.get(link.bone.parent);
      if (!parentLink) continue;

      link.bone.getWorldPosition(boneWorldPos);
      const joint = new CANNON.Vec3(boneWorldPos.x, boneWorldPos.y, boneWorldPos.z);
      const pivotA = parentLink.body.pointToLocalFrame(joint);
      const pivotB = link.body.pointToLocalFrame(joint);
      const jointAxis = this.cannonVecFromThree(this.segmentWorldDirection(link));
      const constraint = new CANNON.ConeTwistConstraint(parentLink.body, link.body, {
        pivotA,
        pivotB,
        axisA: parentLink.body.vectorToLocalFrame(jointAxis),
        axisB: link.body.vectorToLocalFrame(jointAxis),
        angle: this.jointConeAngle(link.bone.name),
        twistAngle: this.jointTwistAngle(link.bone.name),
        maxForce: 2.5e5,
        collideConnected: false,
      });
      constraint.collideConnected = false;
      this.world.addConstraint(constraint);
      constraints.push(constraint);
    }

    if (links.length === 0) {
      this.spawnTumble(mesh, impulse);
      return;
    }

    const rootLink = this.pickRootLink(links);
    this.applySkeletonImpulse(links, impulse);

    this.ragdolls.push({
      root: mesh,
      skinned,
      links,
      constraints,
      body: null,
      rootOffset: new THREE.Vector3(),
      rootBody: rootLink?.body ?? null,
      rootBindWorldPosition: rootLink
        ? new THREE.Vector3(rootLink.body.position.x, rootLink.body.position.y, rootLink.body.position.z)
        : new THREE.Vector3(),
      rootBindPosition: mesh.position.clone(),
      proxyRoot: null,
      proxyLinks: [],
      age: 0,
      lifetime: 5.5,
    });
  }

  private spawnTumble(mesh: THREE.Group, impulse?: RagdollImpulse): void {
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
      collisionFilterMask: RAGDOLL_COLLISION_MASK,
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
      rootBody: null,
      rootBindWorldPosition: new THREE.Vector3(),
      rootBindPosition: new THREE.Vector3(),
      proxyRoot: null,
      proxyLinks: [],
      age: 0,
      lifetime: 4.5,
    });
  }

  private syncProxy(rag: ActiveRagdoll): void {
    for (const { body, mesh } of rag.proxyLinks) {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      mesh.updateMatrixWorld(true);
    }
  }

  private syncSkeleton(rag: ActiveRagdoll): void {
    if (!rag.skinned) return;

    if (rag.rootBody) {
      const delta = new THREE.Vector3(
        rag.rootBody.position.x - rag.rootBindWorldPosition.x,
        rag.rootBody.position.y - rag.rootBindWorldPosition.y,
        rag.rootBody.position.z - rag.rootBindWorldPosition.z
      );
      rag.root.position.copy(rag.rootBindPosition).add(delta);
      rag.root.updateMatrixWorld(true);
    }

    const bodyQuat = new THREE.Quaternion();
    const desiredWorldQuat = new THREE.Quaternion();
    const localQuat = new THREE.Quaternion();
    const parentWorldQuat = new THREE.Quaternion();
    const parentInvQuat = new THREE.Quaternion();

    for (const link of rag.links) {
      const { bone, body } = link;

      bone.position.copy(link.bindLocalPosition);

      bodyQuat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      desiredWorldQuat.copy(bodyQuat).multiply(link.bodyToBoneQuaternion);
      localQuat.copy(desiredWorldQuat);

      if (bone.parent) {
        bone.parent.updateMatrixWorld(true);
        bone.parent.getWorldQuaternion(parentWorldQuat);
        parentInvQuat.copy(parentWorldQuat).invert();
        localQuat.premultiply(parentInvQuat);
      }

      bone.quaternion.copy(localQuat.normalize());
      bone.updateMatrixWorld(true);
    }

    rag.skinned.skeleton.update();
    this.keepAboveGround(rag.root);
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

  private applySkeletonImpulse(links: BoneLink[], impulse?: RagdollImpulse): void {
    const pelvis =
      links.find(link => /pelvis|hips|spine/i.test(link.bone.name)) ??
      links[Math.floor(links.length * 0.35)] ??
      links[0];

    if (!impulse) {
      if (pelvis) this.applyImpulse(pelvis.body, this.randomImpulse(), 4.2);
      return;
    }

    const hitLink = impulse.point ? this.closestLinkToPoint(links, impulse.point) : pelvis;
    if (hitLink) this.applyImpulse(hitLink.body, impulse, 7.8);
    if (pelvis && pelvis !== hitLink) this.applyImpulse(pelvis.body, impulse, 2.4);
  }

  private closestLinkToPoint(links: BoneLink[], point: THREE.Vector3): BoneLink | null {
    let best: BoneLink | null = null;
    let bestDist = Infinity;

    for (const link of links) {
      const dx = link.body.position.x - point.x;
      const dy = link.body.position.y - point.y;
      const dz = link.body.position.z - point.z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        best = link;
        bestDist = dist;
      }
    }

    return best;
  }

  private closestProxyToPoint(links: ProxyLink[], point: THREE.Vector3): CANNON.Body | null {
    let best: CANNON.Body | null = null;
    let bestDist = Infinity;

    for (const { body } of links) {
      const dx = body.position.x - point.x;
      const dy = body.position.y - point.y;
      const dz = body.position.z - point.z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        best = body;
        bestDist = dist;
      }
    }

    return best;
  }

  private segmentWorldDirection(link: BoneLink): THREE.Vector3 {
    const from = link.bone.getWorldPosition(new THREE.Vector3());
    const to = link.child?.getWorldPosition(new THREE.Vector3());
    if (!to) return new THREE.Vector3(0, 1, 0);

    const dir = to.sub(from);
    return dir.lengthSq() > 0.0001 ? dir.normalize() : new THREE.Vector3(0, 1, 0);
  }

  private cannonVecFromThree(v: THREE.Vector3): CANNON.Vec3 {
    return new CANNON.Vec3(v.x, v.y, v.z);
  }

  private jointConeAngle(boneName: string): number {
    const name = boneName.toLowerCase();
    if (/forearm|lowerarm|calf|lowerleg|shin/.test(name)) return Math.PI * 0.16;
    if (/head|neck/.test(name)) return Math.PI * 0.18;
    if (/upperarm|thigh|upperleg/.test(name)) return Math.PI * 0.36;
    if (/spine|chest|pelvis|hips/.test(name)) return Math.PI * 0.2;
    return Math.PI * 0.28;
  }

  private jointTwistAngle(boneName: string): number {
    const name = boneName.toLowerCase();
    if (/forearm|lowerarm|calf|lowerleg|shin/.test(name)) return Math.PI * 0.08;
    if (/head|neck/.test(name)) return Math.PI * 0.12;
    if (/upperarm|thigh|upperleg/.test(name)) return Math.PI * 0.2;
    return Math.PI * 0.14;
  }

  private keepAboveGround(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const minY = MODEL_FLOOR_Y - 0.015;
    if (!Number.isFinite(box.min.y) || box.min.y >= minY) return;

    root.position.y += minY - box.min.y;
    root.updateMatrixWorld(true);
  }

  private applyImpulse(
    body: CANNON.Body,
    impulse: RagdollImpulse | THREE.Vector3,
    strength: number
  ): void {
    const dir = impulse instanceof THREE.Vector3 ? impulse : impulse.direction;
    const normalized = dir.lengthSq() > 0.0001 ? dir.clone().normalize() : this.randomImpulse();
    const finalStrength = impulse instanceof THREE.Vector3 ? strength : impulse.strength ?? strength;
    const upward = impulse instanceof THREE.Vector3 ? 1.4 : impulse.upward ?? 1.2;
    const hitPoint = impulse instanceof THREE.Vector3 ? undefined : impulse.point;
    const relativePoint = hitPoint
      ? new CANNON.Vec3(
          hitPoint.x - body.position.x,
          hitPoint.y - body.position.y,
          hitPoint.z - body.position.z
        )
      : new CANNON.Vec3(0, 0.12, 0);

    body.applyImpulse(
      new CANNON.Vec3(
        normalized.x * finalStrength,
        normalized.y * finalStrength * 0.35 + upward,
        normalized.z * finalStrength
      ),
      relativePoint
    );
    body.angularVelocity.x += (Math.random() - 0.5) * 5.5 + normalized.z * 2.2;
    body.angularVelocity.y += (Math.random() - 0.5) * 2.4;
    body.angularVelocity.z += (Math.random() - 0.5) * 5.5 - normalized.x * 2.2;
  }

  private randomImpulse(): THREE.Vector3 {
    return new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0.3 + Math.random() * 0.35,
      (Math.random() - 0.5) * 2
    ).normalize();
  }

  stabilizeSkinnedCorpse(skinned: THREE.SkinnedMesh): void {
    const tmp = new THREE.Quaternion();

    for (const bone of skinned.skeleton.bones) {
      const name = bone.name.toLowerCase();
      const side = this.boneSide(name);
      tmp.identity();

      if (/upperarm|arm|shoulder/.test(name) && side !== 0) {
        tmp.setFromEuler(new THREE.Euler(0.08, 0, side * 0.28));
      } else if (/forearm|lowerarm/.test(name) && side !== 0) {
        tmp.setFromEuler(new THREE.Euler(0.16, 0, side * 0.18));
      } else if (/thigh|upperleg/.test(name) && side !== 0) {
        tmp.setFromEuler(new THREE.Euler(-0.12, 0, side * 0.12));
      } else if (/calf|lowerleg|shin/.test(name)) {
        tmp.setFromEuler(new THREE.Euler(0.22, 0, 0));
      } else if (/spine|chest/.test(name)) {
        tmp.setFromEuler(new THREE.Euler(0.06, 0, 0));
      } else {
        continue;
      }

      bone.quaternion.multiply(tmp);
      bone.updateMatrixWorld(true);
    }

    skinned.skeleton.update();
  }

  private boneSide(name: string): number {
    if (/left|\.l|_l\b| l\b/.test(name)) return 1;
    if (/right|\.r|_r\b| r\b/.test(name)) return -1;
    return 0;
  }

  private makeProxyMaterial(root: THREE.Object3D): THREE.MeshStandardMaterial {
    let source: THREE.MeshStandardMaterial | null = null;

    root.traverse(child => {
      if (source || !(child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          source = material;
          return;
        }
      }
    });

    const material = source === null
      ? new THREE.MeshStandardMaterial({ color: 0x222733, roughness: 0.85, metalness: 0.15 })
      : (source as THREE.MeshStandardMaterial).clone();

    material.map = null;
    material.normalMap = null;
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.color.lerp(new THREE.Color(0x111318), 0.35);
    material.roughness = Math.max(material.roughness, 0.7);
    material.metalness = Math.min(material.metalness, 0.25);
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
    material.needsUpdate = true;
    return material;
  }

  private primaryBoneChild(bone: THREE.Bone): THREE.Bone | null {
    let best: THREE.Bone | null = null;
    let bestLen = 0;

    for (const child of bone.children) {
      if (!(child instanceof THREE.Bone)) continue;
      const len = child.position.lengthSq();
      if (len > bestLen) {
        best = child;
        bestLen = len;
      }
    }

    return best;
  }

  private isUsefulSegment(bone: THREE.Bone, child: THREE.Bone): boolean {
    const name = `${bone.name} ${child.name}`.toLowerCase();
    if (/finger|thumb|index|middle|ring|pinky|toe|hair|weapon|prop|end/i.test(name)) return false;
    return child.position.length() > 0.045;
  }

  private pickRootLink(links: BoneLink[]): BoneLink | null {
    return (
      links.find(link => /pelvis|hips|spine|chest/i.test(link.bone.name)) ??
      links[Math.floor(links.length * 0.3)] ??
      links[0] ??
      null
    );
  }

  private segmentRadius(bone: THREE.Bone, length: number): number {
    const name = bone.name.toLowerCase();
    const byLength = THREE.MathUtils.clamp(length * 0.18, 0.035, 0.13);
    if (name.includes('head') || name.includes('neck')) return Math.max(byLength, 0.105);
    if (name.includes('pelvis') || name.includes('hips')) return Math.max(byLength, 0.15);
    if (name.includes('spine') || name.includes('chest')) return Math.max(byLength, 0.14);
    if (name.includes('thigh') || name.includes('upperleg')) return Math.max(byLength, 0.085);
    if (name.includes('calf') || name.includes('lowerleg')) return Math.max(byLength, 0.07);
    if (name.includes('upperarm')) return Math.max(byLength, 0.075);
    if (name.includes('lowerarm')) return Math.max(byLength, 0.06);
    if (name.includes('hand') || name.includes('foot')) return Math.max(byLength, 0.055);
    return byLength;
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
    for (const { body } of rag.proxyLinks) this.world.removeBody(body);
    if (rag.body) this.world.removeBody(rag.body);

    if (rag.proxyRoot) {
      rag.proxyRoot.parent?.remove(rag.proxyRoot);
      rag.proxyRoot.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }

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
