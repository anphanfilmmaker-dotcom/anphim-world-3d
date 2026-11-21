import {defineConfig} from 'vite';
import {cpSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtimeAssets = ['assets', 'models', 'references', 'WORLD_V24_CAMPUS_LAYOUT.json', 'WORLD_V24_ASSET_MANIFEST.json', 'campus-palette.json'];

function copyRuntimeAssets() {
  let outDir;
  return {
    name: 'copy-runtime-assets',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      for (const p of runtimeAssets) cpSync(resolve(root, p), resolve(outDir, p), {recursive: true});
    }
  };
}

export default defineConfig({
  base: './',
  build: {target: 'es2022', assetsDir: '_vite'},
  resolve: {alias: {three: fileURLToPath(new URL('./vendor/three.module.js', import.meta.url))}},
  plugins: [copyRuntimeAssets()]
});
