import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.fbx', '**/*.JPEG', '**/*.jpeg', '**/*.jpg', '**/*.png'],
  server: {
    port: 5173,
    open: true,
  },
});