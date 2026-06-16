import * as THREE from 'three';
import { MODEL_FLOOR_Y } from './Coords3D';

const BASE = {
  asphalt: { r: 72, g: 76, b: 82 },
  concrete: { r: 118, g: 121, b: 126 },
  gravel: { r: 98, g: 90, b: 74 },
} as const;

const PX_PER_UNIT = 42;

let maxAnisotropy = 16;
let unifiedTexture: THREE.CanvasTexture | null = null;
let unifiedNormal: THREE.CanvasTexture | null = null;
let unifiedRoughness: THREE.CanvasTexture | null = null;
let unifiedMaterial: THREE.MeshStandardMaterial | null = null;
let groundPlaneMaterial: THREE.MeshStandardMaterial | null = null;

/** Вызывать из Renderer3D после создания WebGLRenderer */
export function setFloorTextureAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, Math.min(16, value));
}

function configureFloorMap(tex: THREE.CanvasTexture, isColor = false): THREE.CanvasTexture {
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function hash2(x: number, y: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function valueNoise2d(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0);
  const n10 = hash2(x0 + 1, y0);
  const n01 = hash2(x0, y0 + 1);
  const n11 = hash2(x0 + 1, y0 + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2d(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return value / total;
}

function terrainWeights(gx: number, gy: number): { wa: number; wc: number; wg: number } {
  const n1 = fbm(gx * 0.085, gy * 0.085, 5);
  const n2 = fbm(gx * 0.11 + 31, gy * 0.11 + 17, 4);
  const n3 = fbm(gx * 0.16 + 9, gy * 0.16 + 44, 4);

  const wAsphalt = smoothstep(0.28, 0.62, n1);
  const wConcrete = smoothstep(0.32, 0.68, n2);
  const wGravel = smoothstep(0.38, 0.72, n3);
  const sum = wAsphalt + wConcrete + wGravel + 0.0001;

  return {
    wa: wAsphalt / sum,
    wc: wConcrete / sum,
    wg: wGravel / sum,
  };
}

function heightAt(gx: number, gy: number): number {
  const { wa, wc, wg } = terrainWeights(gx, gy);
  const macro = fbm(gx * 0.22 + 4, gy * 0.22 + 9, 3);
  const fine = fbm(gx * 1.8, gy * 1.8, 4);
  const micro = hash2(gx * 41.2, gy * 37.6);

  let h = macro * 0.55 + fine * 0.28 + micro * 0.08;
  h += wa * 0.06 + wc * 0.04 + wg * 0.1;
  return h;
}

function blendTerrainColor(gx: number, gy: number): { r: number; g: number; b: number } {
  const { wa, wc, wg } = terrainWeights(gx, gy);

  let r = BASE.asphalt.r * wa + BASE.concrete.r * wc + BASE.gravel.r * wg;
  let g = BASE.asphalt.g * wa + BASE.concrete.g * wc + BASE.gravel.g * wg;
  let b = BASE.asphalt.b * wa + BASE.concrete.b * wc + BASE.gravel.b * wg;

  const fine = fbm(gx * 2.4, gy * 2.4, 4);
  const grain = (fine - 0.5) * 18;
  const micro = (hash2(gx * 97.3, gy * 63.1) - 0.5) * 20;
  const grit = (hash2(gx * 173.7, gy * 149.3) - 0.5) * 12;
  r += grain + micro + grit;
  g += grain + micro + grit * 0.95;
  b += grain * 0.92 + micro * 0.88 + grit * 0.85;

  const stain = fbm(gx * 0.35 + 80, gy * 0.35 + 120, 3);
  const wet = fbm(gx * 0.5 + 12, gy * 0.5 + 44, 2);
  r += (stain - 0.5) * 12 + (wet - 0.45) * 8;
  g += (stain - 0.5) * 12 + (wet - 0.45) * 8;
  b += (stain - 0.5) * 14 + (wet - 0.4) * 9;

  const tileEdge = Math.min(
    smoothstep(0.02, 0.08, gx - Math.floor(gx)),
    smoothstep(0.02, 0.08, Math.ceil(gx) - gx),
    smoothstep(0.02, 0.08, gy - Math.floor(gy)),
    smoothstep(0.02, 0.08, Math.ceil(gy) - gy)
  );
  const edgeDark = (1 - tileEdge) * 6;
  r -= edgeDark;
  g -= edgeDark;
  b -= edgeDark * 1.05;

  if (wg > 0.45) {
    const pebble = hash2(gx * 31.7, gy * 27.3);
    if (pebble > 0.92) {
      const tone = 55 + hash2(gx * 11, gy * 13) * 70;
      r = lerp(r, tone + 12, 0.65);
      g = lerp(g, tone + 6, 0.65);
      b = lerp(b, tone, 0.65);
    }
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

function roughnessAt(gx: number, gy: number): number {
  const { wa, wc, wg } = terrainWeights(gx, gy);
  let r = 0.82 * wa + 0.76 * wc + 0.94 * wg;
  r += (fbm(gx * 3.1, gy * 3.1, 3) - 0.5) * 0.12;
  return Math.max(0.55, Math.min(0.98, r));
}

function paintCracksOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gridW: number,
  gridH: number
): void {
  const count = Math.floor(gridW * gridH * 0.42);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const gx = hash2(i * 3.1, i * 7.3) * gridW;
    const gy = hash2(i * 5.7, i * 2.9) * gridH;
    const px = (gx / gridW) * width;
    const py = (gy / gridH) * height;
    const len = 10 + hash2(i, i + 4) * 36;
    const angle = hash2(i + 1, i + 2) * Math.PI * 2;
    const alpha = 0.1 + hash2(i + 3, i + 5) * 0.18;

    ctx.strokeStyle = `rgba(14,16,20,${alpha})`;
    ctx.lineWidth = 0.8 + hash2(i + 6, i) * 1.6;
    ctx.beginPath();
    ctx.moveTo(px, py);
    let x = px;
    let y = py;
    const segments = 2 + Math.floor(hash2(i + 7, i) * 3);
    for (let s = 0; s < segments; s++) {
      const segLen = len / segments;
      const a = angle + (hash2(i + s, i + s * 2) - 0.5) * 1.2;
      x += Math.cos(a) * segLen;
      y += Math.sin(a) * segLen;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintStainsOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gridW: number,
  gridH: number
): void {
  const count = Math.floor(gridW * gridH * 0.22);
  for (let i = 0; i < count; i++) {
    const px = hash2(i * 1.3, i * 2.7) * width;
    const py = hash2(i * 4.1, i * 1.9) * height;
    const r = 6 + hash2(i, i + 1) * 22;
    const warm = hash2(i + 2, i) > 0.5;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    if (warm) {
      g.addColorStop(0, 'rgba(55,48,38,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      g.addColorStop(0, 'rgba(28,32,38,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function generateNormalMap(width: number, height: number, strength = 4.2): THREE.CanvasTexture {
  const image = new ImageData(width, height);
  const data = image.data;
  const step = 1 / PX_PER_UNIT;

  for (let py = 0; py < height; py++) {
    const gy = py / PX_PER_UNIT;
    for (let px = 0; px < width; px++) {
      const gx = px / PX_PER_UNIT;
      const hL = heightAt(gx - step, gy);
      const hR = heightAt(gx + step, gy);
      const hD = heightAt(gx, gy - step);
      const hU = heightAt(gx, gy + step);

      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      let nz = 1;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const i = (py * width + px) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(image, 0, 0);

  return configureFloorMap(new THREE.CanvasTexture(canvas));
}

function generateRoughnessMap(width: number, height: number): THREE.CanvasTexture {
  const image = new ImageData(width, height);
  const data = image.data;

  for (let py = 0; py < height; py++) {
    const gy = (py + 0.5) / PX_PER_UNIT;
    for (let px = 0; px < width; px++) {
      const gx = (px + 0.5) / PX_PER_UNIT;
      const rough = roughnessAt(gx, gy);
      const v = Math.round(rough * 255);
      const i = (py * width + px) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(image, 0, 0);

  return configureFloorMap(new THREE.CanvasTexture(canvas));
}

function generateUnifiedFloorTexture(gridW: number, gridH: number): THREE.CanvasTexture {
  const width = gridW * PX_PER_UNIT;
  const height = gridH * PX_PER_UNIT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let py = 0; py < height; py++) {
    const gy = (py + 0.5) / PX_PER_UNIT;
    for (let px = 0; px < width; px++) {
      const gx = (px + 0.5) / PX_PER_UNIT;
      const { r, g, b } = blendTerrainColor(gx, gy);
      const i = (py * width + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  paintStainsOnCanvas(ctx, width, height, gridW, gridH);
  paintCracksOnCanvas(ctx, width, height, gridW, gridH);

  return configureFloorMap(new THREE.CanvasTexture(canvas), true);
}

function ensureUnifiedFloor(gridW: number, gridH: number): THREE.MeshStandardMaterial {
  if (!unifiedMaterial || !unifiedTexture) {
    const width = gridW * PX_PER_UNIT;
    const height = gridH * PX_PER_UNIT;
    unifiedTexture = generateUnifiedFloorTexture(gridW, gridH);
    unifiedNormal = generateNormalMap(width, height);
    unifiedRoughness = generateRoughnessMap(width, height);

    unifiedMaterial = new THREE.MeshStandardMaterial({
      map: unifiedTexture,
      normalMap: unifiedNormal,
      roughnessMap: unifiedRoughness,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.03,
      normalScale: new THREE.Vector2(1.15, 1.15),
    });
  }
  return unifiedMaterial;
}

/** Единый бесшовный пол карты — без щелей между клетками */
export function createUnifiedFloorMesh(gridW: number, gridH: number): THREE.Mesh {
  const material = ensureUnifiedFloor(gridW, gridH);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(gridW, gridH), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = MODEL_FLOOR_Y - 0.002;
  mesh.receiveShadow = true;
  mesh.name = 'unifiedFloor';
  return mesh;
}

export function getGroundPlaneMaterial(): THREE.MeshStandardMaterial {
  if (!groundPlaneMaterial) {
    groundPlaneMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a323c,
      roughness: 1,
      metalness: 0,
    });
  }
  return groundPlaneMaterial;
}

export function disposeFloorTextures(): void {
  unifiedMaterial?.dispose();
  unifiedMaterial = null;
  unifiedTexture?.dispose();
  unifiedTexture = null;
  unifiedNormal?.dispose();
  unifiedNormal = null;
  unifiedRoughness?.dispose();
  unifiedRoughness = null;
  groundPlaneMaterial?.dispose();
  groundPlaneMaterial = null;
}