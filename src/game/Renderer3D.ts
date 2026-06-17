import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Position } from '../types';
import { GRID_H, GRID_W } from './Grid';
import type { Battle } from './Battle';
import type { AnimationManager } from './Animations';
import { MODEL_FLOOR_Y, gridDepth, gridToWorld, worldToGrid } from './Coords3D';
import { createUnifiedFloorMesh, getGroundPlaneMaterial, setFloorTextureAnisotropy } from './FloorTextures';
import {
  clearMaterialCache,
  createHighlightTile,
  createPathMarker,
  createTerrainTile,
  createUnitMesh,
  updateHpBarPlane,
} from './Meshes3D';
import { calculateHitChance, traceShotRay } from './Combat';
import { CameraInput } from './CameraInput';
import { isRoundBuilding } from './ModelCatalog';
import { modelLoader } from './ModelLoader';

export class Renderer3D {
  container: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  labelsLayer: HTMLElement;

  terrainGroup = new THREE.Group();
  propsGroup = new THREE.Group();
  unitsGroup = new THREE.Group();
  highlightsGroup = new THREE.Group();
  propMeshes = new Map<number, THREE.Group>();
  unitMeshes = new Map<string, THREE.Group>();
  tileMeshes = new Map<string, THREE.Group>();
  groundPlane: THREE.Mesh;

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  pulse = 0;
  cameraInput: CameraInput;


  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6a7f96);
    this.scene.fog = new THREE.FogExp2(0x8a9bb0, 0.0032);

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    this.camera.position.set(22, 38, 28);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    setFloorTextureAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    container.appendChild(this.renderer.domElement);

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.appendChild(this.labelsLayer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // polar: 0 = сверху, π/2 = у горизонта; почти до уровня земли
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minPolarAngle = Math.PI / 8;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 80;
    this.controls.target.set(0, 0, 0);
    // ЛКМ+drag — панорама; ЛКМ клик — карта; ПКМ — вращение; колёсико — зум; WASD — движение
    this.controls.mouseButtons = {
      LEFT: -1 as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    // Один палец — панорама (CameraInput); два — зум и вращение
    this.controls.touches = {
      ONE: -1 as THREE.TOUCH,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };

    this.groundPlane = this.createGroundPlane();

    this.setupLights();
    this.scene.add(
      this.groundPlane,
      this.terrainGroup,
      this.propsGroup,
      this.unitsGroup,
      this.highlightsGroup
    );

    this.cameraInput = new CameraInput(this.camera, this.controls, this.renderer.domElement);
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xc8d4e4, 0.72);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xdce8f5, 0x6a7568, 0.58);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e8, 2.1);
    sun.position.set(18, 32, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xb8c8e8, 0.85);
    fill.position.set(-22, 18, -12);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe8cc, 0.45);
    rim.position.set(-6, 10, 24);
    this.scene.add(rim);
  }

  private createGroundPlane(): THREE.Mesh {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_W + 6, GRID_H + 6),
      getGroundPlaneMaterial()
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    return plane;
  }

  buildTerrain(battle: Battle): void {
    this.clearTerrainGroup();
    this.tileMeshes.clear();

    this.terrainGroup.add(createUnifiedFloorMesh(GRID_W, GRID_H));

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        this.addTileMesh(x, y, battle.grid.getTile(x, y)!);
      }
    }
    this.buildProps(battle);
  }

  private createPropModel(prop: import('../types').MapProp): THREE.Group | null {
    const fitScale = 0.94;

    if (prop.w <= 1 && prop.h <= 1) {
      return modelLoader.clone(prop.modelId);
    }

    if (isRoundBuilding(prop.modelId)) {
      const diameter = Math.max(prop.w, prop.h) * fitScale;
      return modelLoader.cloneScaled(prop.modelId, diameter, diameter, true);
    }

    return modelLoader.cloneScaled(
      prop.modelId,
      prop.w * fitScale,
      prop.h * fitScale
    );
  }

  private buildProps(battle: Battle): void {
    this.propsGroup.clear();
    this.propMeshes.clear();

    if (!modelLoader.ready) return;

    for (const prop of battle.grid.props) {
      if (!battle.grid.isPropActive(prop.id)) continue;

      const model = this.createPropModel(prop);
      if (!model) continue;

      const cx = prop.x + (prop.w - 1) / 2;
      const cy = prop.y + (prop.h - 1) / 2;
      const pos = gridToWorld(cx, cy);
      model.position.x = pos.x;
      model.position.z = pos.z;
      model.position.y += MODEL_FLOOR_Y;
      model.rotation.y = prop.rotation;
      model.userData = { propId: prop.id };

      this.propsGroup.add(model);
      this.propMeshes.set(prop.id, model);
    }
  }

  updateProps(battle: Battle): void {
    for (const [propId, mesh] of this.propMeshes) {
      if (!battle.grid.isPropActive(propId)) {
        this.propsGroup.remove(mesh);
        this.disposeGroup(mesh);
        this.propMeshes.delete(propId);
      }
    }
  }

  private addTileMesh(x: number, y: number, tile: import('../types').Tile): void {
    const mesh = createTerrainTile(x, y, tile);
    const key = `${x},${y}`;
    this.tileMeshes.set(key, mesh);
    this.terrainGroup.add(mesh);
  }

  updateTilesAt(battle: Battle, positions: Position[]): void {
    for (const pos of positions) {
      const key = `${pos.x},${pos.y}`;
      const old = this.tileMeshes.get(key);
      if (old) {
        this.terrainGroup.remove(old);
        this.disposeGroup(old);
      }
      const tile = battle.grid.getTile(pos.x, pos.y);
      if (tile) this.addTileMesh(pos.x, pos.y, tile);
    }
    this.updateProps(battle);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render(battle: Battle, animations: AnimationManager, dt: number): void {
    this.cameraInput.update(dt);
    this.pulse += dt * 3;
    const pulse = (Math.sin(this.pulse) + 1) / 2;

    if (this.terrainGroup.children.length === 0) {
      this.buildTerrain(battle);
    }

    animations.syncUnits(battle.allUnits);

    if (!this.scene.children.includes(animations.effectsGroup)) {
      this.scene.add(animations.effectsGroup);
    }
    if (!this.scene.children.includes(animations.ragdollManager.group)) {
      this.scene.add(animations.ragdollManager.group);
    }

    this.syncUnitMeshes(battle, animations, pulse);
    this.updateHighlights(battle, pulse);
    this.updateHitChanceLabel(battle);

    animations.getFloatingLabelPositions(
      this.camera,
      this.container.clientWidth,
      this.container.clientHeight
    );

    this.controls.update();

    let shakeX = 0;
    let shakeY = 0;
    if (animations.screenShake > 0) {
      const shake = animations.screenShake;
      shakeX = (Math.random() - 0.5) * shake * 0.15;
      shakeY = (Math.random() - 0.5) * shake * 0.1;
      this.camera.position.x += shakeX;
      this.camera.position.y += shakeY;
    }

    this.renderer.render(this.scene, this.camera);

    if (shakeX !== 0 || shakeY !== 0) {
      this.camera.position.x -= shakeX;
      this.camera.position.y -= shakeY;
    }
  }

  private syncUnitMeshes(battle: Battle, animations: AnimationManager, pulseVal: number): void {
    const activeIds = new Set<string>();

    const sorted = [...battle.allUnits].sort((a, b) => {
      const va = animations.getVisual(a.id);
      const vb = animations.getVisual(b.id);
      return gridDepth(va?.x ?? a.position.x, va?.y ?? a.position.y) -
             gridDepth(vb?.x ?? b.position.x, vb?.y ?? b.position.y);
    });

    for (const unit of sorted) {
      activeIds.add(unit.id);
      const visual = animations.getVisual(unit.id);
      if (!visual) continue;

      let mesh = this.unitMeshes.get(unit.id);
      if (!mesh) {
        mesh = createUnitMesh(unit);
        this.unitsGroup.add(mesh);
        this.unitMeshes.set(unit.id, mesh);

        if (mesh.userData.isRigged) {
          const modelId = mesh.userData.modelId as string | undefined;
          const body = mesh.getObjectByName('unitBody');
          if (body && modelId) {
            const clips =
              (body as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations?.length
                ? (body as THREE.Object3D & { animations: THREE.AnimationClip[] }).animations
                : modelLoader.getAnimations(modelId);
            animations.bindUnitRig(unit.id, body, clips);
          }
        }
      }

      if (visual.ragdollActive) continue;

      const pos = gridToWorld(visual.x, visual.y);
      const deathScale = 1 - visual.deathProgress * 0.85;
      const spawnScale = 0.7 + visual.spawnPulse * 0.3;

      const isRigged = mesh.userData.isRigged === true;
      const deathSink = visual.deathProgress * 0.35;
      mesh.position.set(
        pos.x + (visual.hitShake > 0 ? (Math.random() - 0.5) * visual.hitShake * 0.08 : 0),
        MODEL_FLOOR_Y - deathSink,
        pos.z
      );

      const facingPivot = mesh.getObjectByName('facingPivot') as THREE.Group | undefined;
      const bodyPivot = mesh.getObjectByName('bodyPivot') as THREE.Group | undefined;
      const visualScale = spawnScale * deathScale;
      const facingOffset = (mesh.userData.facingOffset as number | undefined) ?? 0;
      const aimYaw = visual.aimAngle + facingOffset;
      mesh.rotation.y = 0;
      if (facingPivot) {
        facingPivot.rotation.y = aimYaw;
      } else {
        mesh.rotation.y = aimYaw;
      }

      if (isRigged) {
        const rigBody = mesh.getObjectByName('unitBody');
        const idleBody = mesh.getObjectByName('unitIdleBody');
        if (idleBody && rigBody) {
          rigBody.visible = visual.rigActive || visual.ragdollActive;
          idleBody.visible = !rigBody.visible;
        }
        if (bodyPivot) bodyPivot.scale.setScalar(1);
      } else if (bodyPivot) {
        bodyPivot.scale.setScalar(visualScale);
      } else {
        mesh.scale.setScalar(visualScale);
      }
      mesh.visible = unit.isAlive || visual.deathProgress < 1 || visual.ragdollActive;

      // Selection ring
      const selRing = mesh.getObjectByName('selectionRing') as THREE.Mesh;
      if (selRing) {
        const mat = selRing.material as THREE.MeshBasicMaterial;
        const isSelected = unit.id === battle.selectedUnit?.id && unit.isAlive;
        mat.opacity = isSelected ? 0.6 + pulseVal * 0.3 : 0;
        selRing.scale.setScalar(isSelected ? 1 + pulseVal * 0.1 : 1);
      }

      // Overwatch ring
      const owRing = mesh.getObjectByName('overwatchRing') as THREE.Mesh;
      if (owRing) {
        const mat = owRing.material as THREE.MeshBasicMaterial;
        mat.opacity = unit.isOverwatching ? 0.4 + animations.overwatchPulse * 0.5 : 0;
      }

      // HP bar billboard (single canvas plane — no z-fighting)
      const hpBar = mesh.getObjectByName('hpBar') as THREE.Group;
      const hpPlane = hpBar?.getObjectByName('hpBarPlane') as THREE.Mesh;
      if (hpBar && hpPlane) {
        const pct = unit.hp / unit.maxHp;
        const color = visual.flash > 0.5 ? 0xffffff : pct > 0.3 ? 0x2ecc71 : 0xe74c3c;
        updateHpBarPlane(hpPlane, pct, color);
        hpBar.lookAt(this.camera.position);
      }

      // Hit flash emissive on body children
      mesh.traverse(child => {
        if (
          (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) &&
          child.material instanceof THREE.MeshStandardMaterial
        ) {
          if (visual.flash > 0) {
            child.material.emissive.setHex(0xffffff);
            child.material.emissiveIntensity = visual.flash * 0.8;
          } else {
            child.material.emissiveIntensity = 0;
          }
        }
      });
    }

    for (const [id, mesh] of this.unitMeshes) {
      if (!activeIds.has(id)) {
        animations.unbindUnitRig(id);
        this.unitsGroup.remove(mesh);
        this.disposeGroup(mesh);
        this.unitMeshes.delete(id);
      }
    }
  }

  setupAnimations(animations: AnimationManager): void {
    animations.meshProvider = unitId => this.unitMeshes.get(unitId) ?? null;
    animations.onRagdollDetach = unitId => {
      animations.unbindUnitRig(unitId);
      this.unitMeshes.delete(unitId);
    };
  }

  private updateHighlights(battle: Battle, pulse: number): void {
    this.highlightsGroup.clear();
    const mode = battle.actionMode;

    if (mode === 'move' && battle.selectedUnit) {
      for (const pos of battle.getReachableTiles()) {
        const h = createHighlightTile(0x00d4aa, 0.2 + pulse * 0.1);
        h.position.copy(gridToWorld(pos.x, pos.y, 0.14));
        this.highlightsGroup.add(h);
      }
      for (let i = 1; i < battle.movePath.length; i++) {
        const m = createPathMarker();
        m.position.copy(gridToWorld(battle.movePath[i].x, battle.movePath[i].y, 0.18));
        this.highlightsGroup.add(m);
      }
    }

    if (mode === 'shoot' && battle.selectedUnit && battle.hoveredTile) {
        const ray = traceShotRay(
          battle.selectedUnit,
          battle.hoveredTile,
          battle.grid,
          battle.allUnits
        );
      if (ray) {
        const line = battle.grid.getLineTiles(battle.selectedUnit.position, ray.endPosition);
        for (let i = 1; i < line.length; i++) {
          const m = createPathMarker();
          m.position.copy(gridToWorld(line[i].x, line[i].y, 0.18));
          this.highlightsGroup.add(m);
        }
      }
    }

    if (mode === 'grenade' && battle.hoveredTile) {
      for (const pos of this.getGrenadeTiles(battle.hoveredTile)) {
        const h = createHighlightTile(0xff4757, 0.35 + pulse * 0.1);
        h.position.copy(gridToWorld(pos.x, pos.y, 0.14));
        this.highlightsGroup.add(h);
      }
    }

    if (battle.hoveredTile) {
      const h = createHighlightTile(0xffffff, 0.08);
      h.position.copy(gridToWorld(battle.hoveredTile.x, battle.hoveredTile.y, 0.13));
      this.highlightsGroup.add(h);
    }
  }

  private hitChanceEl: HTMLDivElement | null = null;

  private updateHitChanceLabel(battle: Battle): void {
    if (this.hitChanceEl) {
      this.hitChanceEl.remove();
      this.hitChanceEl = null;
    }

    if (battle.actionMode !== 'shoot' || !battle.selectedUnit || !battle.hoveredTile) return;

    const ray = traceShotRay(
      battle.selectedUnit,
      battle.hoveredTile,
      battle.grid,
      battle.allUnits
    );
    const unitHit = ray?.hits.find(h => h.kind === 'unit');
    if (!unitHit?.unit) return;

    const chance = calculateHitChance(battle.selectedUnit, unitHit.unit, battle.grid, false, true);
    const worldPos = gridToWorld(unitHit.unit.position.x, unitHit.unit.position.y, 1.8);
    const projected = worldPos.project(this.camera);
    const x = (projected.x * 0.5 + 0.5) * this.container.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * this.container.clientHeight;

    const color = chance >= 50 ? '#2ecc71' : chance >= 25 ? '#f39c12' : '#e74c3c';
    const el = document.createElement('div');
    el.textContent = `${chance}%`;
    el.style.cssText = `
      position: absolute; left: ${x}px; top: ${y}px; transform: translate(-50%,-50%);
      background: rgba(0,0,0,0.8); border: 2px solid ${color}; color: ${color};
      font: bold 16px 'Segoe UI', sans-serif; padding: 4px 12px; border-radius: 4px;
      pointer-events: none; user-select: none;
    `;
    this.labelsLayer.appendChild(el);
    this.hitChanceEl = el;
  }

  private getGrenadeTiles(center: Position): Position[] {
    const tiles: Position[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= 2) {
          const x = center.x + dx;
          const y = center.y + dy;
          if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  screenToGrid(clientX: number, clientY: number): Position | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const terrainHits = this.raycaster.intersectObjects(this.terrainGroup.children, true);
    if (terrainHits.length > 0) {
      const gridPos = this.hitToGrid(terrainHits[0]);
      if (gridPos) return gridPos;
    }

    const groundHits = this.raycaster.intersectObject(this.groundPlane);
    if (groundHits.length > 0) {
      return worldToGrid(groundHits[0].point);
    }

    return null;
  }

  private hitToGrid(hit: THREE.Intersection): Position | null {
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      if (obj.userData.gridX !== undefined && obj.userData.gridY !== undefined) {
        return { x: obj.userData.gridX as number, y: obj.userData.gridY as number };
      }
      obj = obj.parent;
    }
    return worldToGrid(hit.point);
  }

  rebuild(battle: Battle): void {
    for (const mesh of this.unitMeshes.values()) {
      this.unitsGroup.remove(mesh);
      this.disposeGroup(mesh);
    }
    this.unitMeshes.clear();
    this.clearTerrainGroup();
    this.propsGroup.clear();
    this.propMeshes.clear();
    this.tileMeshes.clear();
    this.highlightsGroup.clear();
    this.labelsLayer.innerHTML = '';
    clearMaterialCache();

    this.scene.remove(this.groundPlane);
    this.groundPlane.geometry.dispose();
    (this.groundPlane.material as THREE.Material).dispose();
    this.groundPlane = this.createGroundPlane();
    this.scene.add(this.groundPlane);

    this.buildTerrain(battle);
  }

  private clearTerrainGroup(): void {
    for (const child of [...this.terrainGroup.children]) {
      this.terrainGroup.remove(child);
      if (child.name === 'unifiedFloor' && child instanceof THREE.Mesh) {
        child.geometry.dispose();
        continue;
      }
      this.disposeGroup(child as THREE.Group);
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  get labelsParent(): HTMLElement {
    return this.labelsLayer;
  }
}
