import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtimeAssets = [
  'assets',
  'models',
  'vendor',
  'buildings_config',
  'campus-palette.json',
  'physical-topology.json',
  'operational-graph.json',
  'system-graph.json',
  'live_campus_data.json',
  'catalog-146.json',
  'assets-manifest.json',
  'masterplan.json'
];

function copyRuntimeAssets() {
  let outDir;
  return {
    name: 'copy-runtime-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const p of runtimeAssets) {
        const srcPath = resolve(root, p);
        if (existsSync(srcPath)) {
          cpSync(srcPath, resolve(outDir, p), { recursive: true });
        }
      }
    }
  };
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsDir: '_vite'
  },
  resolve: {
    alias: {
      three: fileURLToPath(new URL('./vendor/three.module.js', import.meta.url))
    }
  },
  plugins: [copyRuntimeAssets()]
});
