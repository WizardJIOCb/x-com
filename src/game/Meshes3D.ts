import * as THREE from 'three';
import type { CoverType, Tile, Unit } from '../types';
import { MODEL_FLOOR_Y, gridToWorld } from './Coords3D';
import { disposeFloorTextures } from './FloorTextures';
import { modelLoader } from './ModelLoader';

const matCache = new Map<string, THREE.MeshStandardMaterial>();

function mat(key: string, props: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial(props));
  }
  return matCache.get(key)!;
}

export function clearMaterialCache(): void {
  matCache.forEach(m => m.dispose());
  matCache.clear();
  disposeFloorTextures();
}

function addTilePicker(group: THREE.Group, x: number, y: number, height = 0.18): void {
  const picker = new THREE.Mesh(
    new THREE.BoxGeometry(0.94, 0.02, 0.94),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  picker.position.y = height;
  picker.userData = { gridX: x, gridY: y, pick: true };
  group.add(picker);
}

export function createTerrainTile(x: number, y: number, tile: Tile): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(gridToWorld(x, y));
  group.userData = { gridX: x, gridY: y, type: 'tile' };

  const isDestructibleWall = tile.type === 'destructible_wall';
  const isSolidWall = tile.type === 'wall' || isDestructibleWall;
  const isMultiTileBuilding =
    tile.propId !== undefined && isSolidWall && !tile.modelId;

  if (isMultiTileBuilding) {
    addTilePicker(group, x, y);
    return group;
  }

  if (tile.modelId && modelLoader.has(tile.modelId)) {
    const model = modelLoader.clone(tile.modelId);
    if (model) {
      model.position.y += MODEL_FLOOR_Y;
      group.add(model);
      addTilePicker(group, x, y, 0.35);
      return group;
    }
  }

  if (isSolidWall) {
    const hpRatio = isDestructibleWall && tile.maxHp > 0 ? tile.hp / tile.maxHp : 1;
    const wallColor = isDestructibleWall
      ? lerpColor(0x8B5A2B, 0x5a3a1a, 1 - hpRatio)
      : 0x4a5a6a;
    const topColor = isDestructibleWall
      ? lerpColor(0xA67C52, 0x6a4a30, 1 - hpRatio)
      : 0x6a7a8a;

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 1.6, 0.92),
      mat(`wall_${isDestructibleWall}_${Math.round(hpRatio * 10)}`, { color: wallColor, roughness: 0.85, metalness: isDestructibleWall ? 0.05 : 0.1 })
    );
    wall.position.y = 0.8;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.08, 0.96),
      mat(`wallTop_${isDestructibleWall}`, { color: topColor, roughness: 0.7, metalness: 0.15 })
    );
    top.position.y = 1.64;
    top.castShadow = true;
    group.add(top);

    if (!isDestructibleWall) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(0.25, 0.2),
        mat('window', { color: 0x88ccff, emissive: 0x224466, emissiveIntensity: 0.6, roughness: 0.3 })
      );
      win.position.set(0, 1.0, 0.47);
      group.add(win);
    } else if (hpRatio < 1) {
      const rubble = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.15, 0.2),
        mat('rubble', { color: 0x444444, roughness: 0.95 })
      );
      rubble.position.set(0.2, 0.1, 0.2);
      group.add(rubble);
    }

    const wallPicker = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 1.6, 0.94),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    wallPicker.position.y = 0.8;
    wallPicker.userData = { gridX: x, gridY: y, pick: true };
    group.add(wallPicker);
  } else {
    addTilePicker(group, x, y);

    if (tile.type === 'destructible' && tile.cover !== 'none') {
      group.add(createCoverMesh(tile.cover, tile.maxHp > 0 ? tile.hp / tile.maxHp : 1));
    }
  }

  return group;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function createCoverMesh(cover: CoverType, hpRatio = 1): THREE.Group {
  const g = new THREE.Group();
  const h = cover === 'full' ? 0.7 : 0.45;

  const baseColor = cover === 'full' ? 0x8B6914 : 0x7a6a50;
  const color = lerpColor(baseColor, 0x3a2a10, 1 - hpRatio);
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.55 * (0.6 + hpRatio * 0.4), h * (0.5 + hpRatio * 0.5), 0.55 * (0.6 + hpRatio * 0.4)),
    mat(`${cover === 'full' ? 'coverFull' : 'coverHalf'}_${Math.round(hpRatio * 10)}`, {
      color,
      roughness: 0.8,
      metalness: 0.1,
    })
  );
  crate.position.y = h / 2 + 0.12;
  crate.castShadow = true;
  crate.receiveShadow = true;
  g.add(crate);

  if (cover === 'full') {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.57, 0.05, 0.57),
      mat('metalBand', { color: 0x555555, roughness: 0.4, metalness: 0.7 })
    );
    band.position.y = h / 2 + 0.12;
    g.add(band);
  }

  return g;
}

function addUnitBody(
  pivot: THREE.Group,
  unit: Unit
): { isRigged: boolean; facingOffset: number; modelId: string | null } {
  const modelId = modelLoader.getUnitModelId(unit);
  if (modelId) {
    const body = modelLoader.clone(modelId);
    if (body) {
      body.name = 'unitBody';
      body.visible = false;
      pivot.add(body);

      const idleModelId = modelLoader.getUnitIdleModelId(unit);
      const idleBody = idleModelId ? modelLoader.clone(idleModelId) : null;
      if (idleBody) {
        idleBody.name = 'unitIdleBody';
        pivot.add(idleBody);
      } else {
        body.visible = true;
      }

      return {
        isRigged: modelLoader.hasSkinnedMesh(body),
        facingOffset: modelLoader.getFacingOffset(modelId),
        modelId,
      };
    }
  }

  if (unit.team === 'soldier') {
    buildSoldier(pivot, unit.className);
  } else {
    buildAlien(pivot, unit.className);
  }
  return { isRigged: false, facingOffset: 0, modelId: null };
}

export function createUnitMesh(unit: Unit): THREE.Group {
  const group = new THREE.Group();
  group.userData = { unitId: unit.id };

  const facingPivot = new THREE.Group();
  facingPivot.name = 'facingPivot';
  group.add(facingPivot);

  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'bodyPivot';
  facingPivot.add(bodyPivot);

  const { isRigged, facingOffset, modelId } = addUnitBody(bodyPivot, unit);
  group.userData.isRigged = isRigged;
  group.userData.facingOffset = facingOffset;
  if (modelId) group.userData.modelId = modelId;

  // Selection ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.42, 32),
    new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.name = 'selectionRing';
  group.add(ring);

  // Overwatch ring
  const owRing = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.48, 32),
    new THREE.MeshBasicMaterial({ color: 0xffa502, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  owRing.rotation.x = -Math.PI / 2;
  owRing.position.y = 0.04;
  owRing.name = 'overwatchRing';
  group.add(owRing);

  group.add(createHpBarGroup());

  return group;
}

function createHpBarGroup(): THREE.Group {
  const barGroup = new THREE.Group();
  barGroup.name = 'hpBar';
  barGroup.position.y = 1.5;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.08),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })
  );
  plane.renderOrder = 900;
  plane.name = 'hpBarPlane';
  plane.userData.hpCanvas = canvas;
  plane.userData.hpTexture = texture;

  barGroup.add(plane);
  updateHpBarPlane(plane, 1, 0x2ecc71);
  return barGroup;
}

export function updateHpBarPlane(plane: THREE.Mesh, pct: number, color: number): void {
  const canvas = plane.userData.hpCanvas as HTMLCanvasElement;
  const texture = plane.userData.hpTexture as THREE.CanvasTexture;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const fillW = Math.max(1, Math.floor((w - 4) * Math.max(0, Math.min(1, pct))));
  const hex = color.toString(16).padStart(6, '0');
  ctx.fillStyle = `#${hex}`;
  ctx.fillRect(2, 2, fillW, h - 4);

  texture.needsUpdate = true;
}

function buildSoldier(group: THREE.Group, className: string): void {
  const colors: Record<string, number> = {
    Assault: 0x3a5a6a,
    Sniper: 0x2d5a3d,
    Support: 0x3d5a80,
    Heavy: 0x4a5568,
  };
  const bodyColor = colors[className] ?? 0x3a5a6a;

  // Legs
  const legMat = mat('soldierLeg', { color: 0x2c3e2c, roughness: 0.9 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.35, 0.14), legMat);
  legL.position.set(-0.1, 0.2, 0);
  legL.castShadow = true;
  const legR = legL.clone();
  legR.position.x = 0.1;
  group.add(legL, legR);

  // Torso
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.38, 0.22),
    mat(`soldierBody_${className}`, { color: bodyColor, roughness: 0.7, metalness: 0.2 })
  );
  torso.position.y = 0.58;
  torso.castShadow = true;
  group.add(torso);

  // Shoulder pads
  const padMat = mat('soldierPad', { color: 0x1a8a70, roughness: 0.5, metalness: 0.4 });
  const padL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), padMat);
  padL.position.set(-0.24, 0.72, 0);
  const padR = padL.clone();
  padR.position.x = 0.24;
  group.add(padL, padR);

  // Head / helmet
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 10),
    mat('soldierHead', { color: 0x4a5a6a, roughness: 0.6, metalness: 0.3 })
  );
  head.position.y = 0.92;
  head.castShadow = true;
  group.add(head);

  // Visor
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.08),
    mat('visor', { color: 0x00ffc8, emissive: 0x006655, emissiveIntensity: 0.8, roughness: 0.2 })
  );
  visor.position.set(0, 0.94, 0.1);
  group.add(visor);

  // Weapon
  if (!group.getObjectByName('unitBody')) {
    const weapon = createWeapon(className, false);
    weapon.name = 'weapon';
    weapon.position.set(0.2, 0.55, 0.15);
    group.add(weapon);
  }
}

function buildAlien(group: THREE.Group, className: string): void {
  if (className === 'Sectoid') {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.1, 0.4, 4, 8),
      mat('sectoidBody', { color: 0x8a9a8a, roughness: 0.6 })
    );
    body.position.y = 0.45;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      mat('sectoidHead', { color: 0x9ab0a0, roughness: 0.5 })
    );
    head.position.y = 0.9;
    head.scale.set(1, 1.2, 0.9);
    head.castShadow = true;
    group.add(head);

    const eyeMat = mat('sectoidEye', { color: 0x9933ff, emissive: 0x6600cc, emissiveIntensity: 1.2 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), eyeMat);
    eyeL.position.set(-0.07, 0.93, 0.12);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.07;
    group.add(eyeL, eyeR);
  } else if (className === 'Thin Man') {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.65, 4, 8),
      mat('thinBody', { color: 0x2a2a3a, roughness: 0.7 })
    );
    body.position.y = 0.55;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      mat('thinHead', { color: 0x8a9a8a, roughness: 0.5 })
    );
    head.position.y = 1.05;
    group.add(head);
  } else {
    // Muton
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.55, 0.3),
      mat('mutonBody', { color: 0x4a6a3a, roughness: 0.7 })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.25, 0.26),
      mat('mutonHead', { color: 0x5a7a4a, roughness: 0.6 })
    );
    head.position.y = 0.95;
    head.castShadow = true;
    group.add(head);

    const eyeMat = mat('mutonEye', { color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 1.5 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), eyeMat);
    eyeL.position.set(-0.08, 0.97, 0.14);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.08;
    group.add(eyeL, eyeR);

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.1, 0.32),
      mat('mutonPlate', { color: 0x3a4a3a, roughness: 0.5, metalness: 0.3 })
    );
    plate.position.y = 0.65;
    group.add(plate);
  }

  if (!group.getObjectByName('unitBody')) {
    const weapon = createWeapon(className, true);
    weapon.name = 'weapon';
    weapon.position.set(0.2, 0.5, 0.15);
    group.add(weapon);
  }
}

function createWeapon(className: string, isAlien: boolean): THREE.Group {
  const g = new THREE.Group();
  const gunColor = isAlien ? 0x7a3aaa : 0x2a3a4a;
  const barrelColor = isAlien ? 0xaa55ff : 0x4a5a6a;

  let length = 0.35;
  let thick = 0.06;
  if (className === 'Sniper') length = 0.55;
  if (className === 'Heavy' || className === 'Muton') { length = 0.4; thick = 0.08; }

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(length, thick, thick * 0.7),
    mat(`gun_${className}_${isAlien}`, { color: gunColor, roughness: 0.4, metalness: 0.6 })
  );
  body.position.x = length / 2;
  g.add(body);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(thick * 0.3, thick * 0.3, length * 0.4, 6),
    mat(`barrel_${isAlien}`, { color: barrelColor, roughness: 0.3, metalness: 0.8, emissive: isAlien ? 0x330066 : 0x002244, emissiveIntensity: 0.3 })
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.position.x = length * 0.85;
  barrel.position.y = 0.02;
  g.add(barrel);

  return g;
}

export function createHighlightTile(color: number, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.15;
  mesh.renderOrder = 10;
  return mesh;
}

export function createPathMarker(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0x00ffc8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.2;
  mesh.renderOrder = 11;
  return mesh;
}
