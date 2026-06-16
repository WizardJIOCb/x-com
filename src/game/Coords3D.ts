import * as THREE from 'three';
import type { Position } from '../types';
import { GRID_H, GRID_W } from './Grid';

export const TILE_SCALE = 1;
/** Верхняя поверхность тайла пола — сюда ставим ноги моделей */
export const MODEL_FLOOR_Y = 0.12;

export function gridToWorld(gx: number, gy: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(
    (gx + 0.5 - GRID_W / 2) * TILE_SCALE,
    y,
    (gy + 0.5 - GRID_H / 2) * TILE_SCALE
  );
}

export function gridPosToWorld(pos: Position, y = 0): THREE.Vector3 {
  return gridToWorld(pos.x, pos.y, y);
}

export function worldToGrid(point: THREE.Vector3): Position | null {
  const gx = Math.floor(point.x / TILE_SCALE + GRID_W / 2);
  const gy = Math.floor(point.z / TILE_SCALE + GRID_H / 2);
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return null;
  return { x: gx, y: gy };
}

export function gridDepth(gx: number, gy: number): number {
  return gx + gy;
}

/** Угол поворота вокруг Y: grid dx → world X, grid dy → world Z */
export function movementYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}