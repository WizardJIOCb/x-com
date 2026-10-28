import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MODEL_FLOOR_Y } from './Coords3D';
import { ALL_DEMO_UNIT_IDS, ALL_HERO_IDS, ALL_MOB_IDS, unitModelId } from './ModelCatalog';
import { modelLoader } from './ModelLoader';
import { UnitRagdollManager, type RagdollImpulse } from './UnitRagdoll';

interface LabModel {
  id: string;
  label: string;
  kind: 'Demo' | 'Бойцы' | 'Монстры';
}

export class RagdollLab {
  private root: HTMLElement;
  private viewport: HTMLElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private ragdoll = new UnitRagdollManager();
  private activeModel: THREE.Group | null = null;
  private activeRig: THREE.Object3D | null = null;
  private activeIdle: THREE.Object3D | null = null;
  private selectedId = '';
  private lastTime = 0;

  private readonly models: LabModel[] = [
    ...ALL_DEMO_UNIT_IDS.map(id => ({
      id: unitModelId('demo', id),
      label: 'Tripo Demo Model',
      kind: 'Demo' as const,
    })),
    ...ALL_HERO_IDS.map(id => ({
      id: unitModelId('hero', id),
      label: this.titleCase(id),
      kind: 'Бойцы' as const,
    })),
    ...ALL_MOB_IDS.map(id => ({
      id: unitModelId('mob', id),
      label: this.titleCase(id),
      kind: 'Монстры' as const,
    })),
  ];

  constructor() {
    document.body.classList.add('ragdoll-lab-page');
    this.root = document.getElementById('app')!;
    this.root.innerHTML = this.renderShell();
    this.viewport = document.getElementById('ragdoll-lab-view')!;

    const width = this.viewport.clientWidth || 900;
    const height = this.viewport.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 120);
    this.camera.position.set(3.4, 2.5, 4.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.viewport.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.6, 0);
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;

    this.scene.background = new THREE.Color(0x64788e);
    this.scene.add(this.ragdoll.group);
    this.setupScene();
    this.bindUi();

    this.selectedId = this.models.find(m => modelLoader.has(m.id))?.id ?? '';
    this.rebuildModelList();
    this.resetModel();

    requestAnimationFrame(t => this.loop(t));
  }

  private renderShell(): string {
    return `
      <main class="ragdoll-lab">
        <aside class="ragdoll-lab-sidebar">
          <div class="ragdoll-lab-brand">
            <div class="ragdoll-lab-title">Ragdoll Lab</div>
            <a class="ragdoll-lab-back" href="/">Вернуться в игру</a>
          </div>
          <div class="ragdoll-lab-actions">
            <button id="ragdoll-hit-btn" class="btn btn-primary" type="button">Ragdoll</button>
            <button id="ragdoll-reset-btn" class="btn" type="button">Сброс</button>
          </div>
          <div class="ragdoll-lab-hint">Клик по модели = попадание в эту часть тела.</div>
          <div id="ragdoll-model-list" class="ragdoll-model-list"></div>
        </aside>
        <section class="ragdoll-lab-stage">
          <div id="ragdoll-lab-view" class="ragdoll-lab-view"></div>
          <div id="ragdoll-lab-status" class="ragdoll-lab-status"></div>
        </section>
      </main>
    `;
  }

  private setupScene(): void {
    const ambient = new THREE.AmbientLight(0xd7e2ef, 0.65);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xe7f1ff, 0x596455, 0.72);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1df, 2.3);
    sun.position.set(4, 7, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0x8b9297, roughness: 0.88, metalness: 0.02 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = MODEL_FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(12, 24, 0x2a3845, 0x546474);
    grid.position.y = MODEL_FLOOR_Y + 0.003;
    this.scene.add(grid);
  }

  private bindUi(): void {
    document.getElementById('ragdoll-hit-btn')?.addEventListener('click', () => {
      this.triggerRagdoll();
    });
    document.getElementById('ragdoll-reset-btn')?.addEventListener('click', () => {
      this.resetModel();
    });
    this.renderer.domElement.addEventListener('pointerup', e => this.handleModelClick(e));
    window.addEventListener('resize', () => this.resize());
  }

  private rebuildModelList(): void {
    const list = document.getElementById('ragdoll-model-list');
    if (!list) return;

    list.innerHTML = '';
    let currentKind: LabModel['kind'] | null = null;

    for (const model of this.models) {
      if (!modelLoader.has(model.id)) continue;
      if (model.kind !== currentKind) {
        currentKind = model.kind;
        const title = document.createElement('div');
        title.className = 'ragdoll-model-section';
        title.textContent = currentKind;
        list.appendChild(title);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ragdoll-model-btn${model.id === this.selectedId ? ' active' : ''}`;
      btn.textContent = model.label;
      btn.addEventListener('click', () => {
        this.selectedId = model.id;
        this.rebuildModelList();
        this.resetModel();
      });
      list.appendChild(btn);
    }
  }

  private resetModel(): void {
    this.ragdoll.clear();
    if (this.activeModel) {
      this.scene.remove(this.activeModel);
      this.disposeObject(this.activeModel);
      this.activeModel = null;
      this.activeRig = null;
      this.activeIdle = null;
    }

    if (!this.selectedId) {
      this.setStatus('Нет загруженных rigged-моделей');
      return;
    }

    const rig = modelLoader.clone(this.selectedId);
    if (!rig) {
      this.setStatus(`Модель ${this.selectedId} не найдена`);
      return;
    }

    const idle = modelLoader.clone(modelLoader.idleModelId(this.selectedId));
    const model = new THREE.Group();
    rig.name = 'unitBody';
    rig.visible = true;
    this.groundChildAt(rig, 0);
    rig.visible = idle === null;
    model.add(rig);

    if (idle) {
      idle.name = 'unitIdleBody';
      idle.visible = true;
      this.groundChildAt(idle, 0);
      model.add(idle);
    }

    model.name = 'ragdollLabModel';
    model.position.y = MODEL_FLOOR_Y;
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);
    this.activeModel = model;
    this.activeRig = rig;
    this.activeIdle = idle;
    this.scene.add(model);
    this.groundVisibleModel();
    this.frameActiveModel();
    this.setStatus(this.modelReadinessText(rig));
    this.setStatus('Готово: нажми Ragdoll или кликни по части тела.');
    this.setStatus(this.modelReadinessText(rig));
  }

  private triggerRagdoll(point?: THREE.Vector3, direction?: THREE.Vector3): void {
    if (!this.activeModel) {
      this.resetModel();
      return;
    }

    const impulse: RagdollImpulse = {
      direction: direction ?? new THREE.Vector3(-0.35, 0.08, -1).normalize(),
      point,
      strength: point ? 9.5 : 7.5,
      upward: point ? 1.1 : 1.4,
    };
    if (this.activeRig) this.activeRig.visible = true;
    if (this.activeIdle) this.activeIdle.visible = false;
    this.groundVisibleModel();
    this.ragdoll.spawn(this.activeModel, impulse);
    this.activeModel = null;
    this.activeRig = null;
    this.activeIdle = null;
    this.setStatus('Ragdoll активен. Сброс вернет модель в исходное состояние.');
  }

  private handleModelClick(event: PointerEvent): void {
    if (!this.activeModel || event.button !== 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObject(this.activeModel, true)
      .filter(hit => hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh);
    const hit = hits[0];
    if (!hit) return;

    this.triggerRagdoll(hit.point.clone(), this.raycaster.ray.direction.clone().normalize());
  }

  private frameActiveModel(): void {
    if (!this.activeModel) return;

    const box = new THREE.Box3().setFromObject(this.activeModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.9);

    this.controls.target.copy(center);
    this.controls.target.y = Math.max(center.y, MODEL_FLOOR_Y + size.y * 0.45);
    this.camera.position.set(center.x + radius * 2.2, center.y + radius * 1.25, center.z + radius * 2.7);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private resize(): void {
    const width = this.viewport.clientWidth || 900;
    const height = this.viewport.clientHeight || 600;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private loop(time: number): void {
    const dt = Math.min(0.05, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;

    this.controls.update();
    this.ragdoll.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(t => this.loop(t));
  }

  private setStatus(text: string): void {
    const status = document.getElementById('ragdoll-lab-status');
    if (status) status.textContent = text;
  }

  private titleCase(id: string): string {
    return id
      .replace(/^unit_(hero|mob)_/, '')
      .split(/[_-]+/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private modelReadinessText(root: THREE.Object3D): string {
    const stats = this.skinnedStats(root);
    if (stats.skinnedMeshes === 0 || stats.bones === 0) {
      return 'Static mesh: skeleton/skin не найден. Эта модель будет падать цельным телом, не bone-by-bone ragdoll.';
    }
    return `Rigged mesh: skinned=${stats.skinnedMeshes}, bones=${stats.bones}. Клик по телу запустит bone-by-bone ragdoll.`;
  }

  private skinnedStats(root: THREE.Object3D): { skinnedMeshes: number; bones: number } {
    let skinnedMeshes = 0;
    let bones = 0;

    root.traverse(child => {
      if (!(child instanceof THREE.SkinnedMesh)) return;
      skinnedMeshes++;
      bones += child.skeleton?.bones.length ?? 0;
    });

    return { skinnedMeshes, bones };
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse(child => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
      else child.material.dispose();
    });
  }

  private groundVisibleModel(): void {
    if (!this.activeModel) return;

    this.activeModel.updateMatrixWorld(true);
    const minY = this.visibleGeometryMinY(this.activeModel);
    if (!Number.isFinite(minY)) return;

    this.activeModel.position.y += MODEL_FLOOR_Y - minY;
    this.activeModel.updateMatrixWorld(true);
  }

  private groundChildAt(child: THREE.Object3D, targetY: number): void {
    child.updateMatrixWorld(true);
    const minY = this.visibleGeometryMinY(child);
    if (!Number.isFinite(minY)) return;

    child.position.y += targetY - minY;
    child.updateMatrixWorld(true);
  }

  private visibleGeometryMinY(root: THREE.Object3D): number {
    let minY = Infinity;
    const point = new THREE.Vector3();
    const box = new THREE.Box3();

    root.traverse(child => {
      if (!this.isVisibleInTree(child)) return;

      if (child instanceof THREE.SkinnedMesh) {
        const pos = child.geometry.attributes.position;
        if (!pos) return;
        child.skeleton.update();
        const step = Math.max(1, Math.floor(pos.count / 1400));
        for (let i = 0; i < pos.count; i += step) {
          point.fromBufferAttribute(pos, i);
          child.applyBoneTransform(i, point);
          point.applyMatrix4(child.matrixWorld);
          minY = Math.min(minY, point.y);
        }
      } else if (child instanceof THREE.Mesh) {
        box.setFromObject(child);
        minY = Math.min(minY, box.min.y);
      }
    });

    return minY;
  }

  private isVisibleInTree(object: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = object;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }
}
