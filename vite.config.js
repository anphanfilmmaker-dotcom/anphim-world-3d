import {defineConfig} from 'vite';
import {cpSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtimeAssets = ['assets', 'models', 'references', 'WORLD_V24_CAMPUS_LAYOUT.json', 'WORLD_V24_ASSET_MANIFEST.json', 'campus-palette.json'];

export default defineConfig({
  base: './',
  build: {target: 'es2022', assetsDir: '_vite'},
  resolve: {alias: {three: fileURLToPath(new URL('./vendor/three.module.js', import.meta.url))}},
  plugins: [{
    name: 'copy-runtime-assets',
    apply: 'build',
    closeBundle() {
      for (const p of runtimeAssets) cpSync(root + p, root + 'dist/' + p, {recursive: true});
    }
  }]
});
