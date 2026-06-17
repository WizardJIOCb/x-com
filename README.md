# X-COM Browser

A browser-based tactical combat prototype inspired by classic X-COM. The game runs in a 3D scene with grid movement, cover, destructible terrain, line-of-sight shooting, grenades, overwatch, simple squad AI, alien AI, and rigged unit animation.

Live build: https://xcom.xedoc.ru/

## Features

- Turn-based tactical combat on a procedurally generated urban map.
- 3D rendering with Three.js, loaded environment props, soldiers, aliens, effects, shadows, and camera controls.
- Movement previews, reachable-tile highlighting, hit chance labels, shot traces, explosions, and floating combat feedback.
- Sequential and simultaneous turn modes.
- Manual squad control or auto-battle mode.
- Destructible walls, cover, props, and terrain damage.
- Rigged character support with walk, death, ragdoll, and procedural leg motion adjustments.
- Responsive HUD with mobile panels for squad, enemies, log, and map view.

## Tech Stack

- TypeScript
- Vite
- Three.js
- cannon-es

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build production assets:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Controls

- Left click: select tiles, units, and actions.
- Left drag / touch drag: pan the camera.
- Right drag: rotate the camera.
- Mouse wheel / pinch: zoom.
- WASD: move the camera.
- HUD buttons: move, shoot, overwatch, grenade, end turn, auto-battle, and turn mode.

## Project Layout

```text
src/main.ts                  Application bootstrap and game loop
src/game/Battle.ts           Turn flow, player actions, AI execution, victory logic
src/game/Renderer3D.ts       Three.js scene, terrain, units, highlights, camera
src/game/Animations.ts       Movement, shots, explosions, labels, screen shake
src/game/UnitRigAnimator.ts  Rigged model animation and procedural walking
src/game/Grid.ts             Map generation, pathfinding, cover, destructible tiles
src/game/Combat.ts           Hit chance, ray tracing, damage, blast resolution
src/game/ModelLoader.ts      Asset loading and model cloning
src/ui/HUD.ts                Desktop and mobile battle interface
src/models/                  3D models, textures, rigged units, and props
```

## Deployment

The production site is built from the repository on the server:

```bash
git fetch origin main
git reset --hard origin/main
npm ci
npm run build
```

The generated `dist` folder is then served by the web root.

