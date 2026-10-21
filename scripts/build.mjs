// Сборка программы для ПК: главный процесс и preload (esbuild), копия интерфейса из apps/ui/dist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import './generate-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-electron');
fs.rmSync(out, { recursive: true, force: true });

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: false, minify: true, logLevel: 'warning' };
await build({ ...common, entryPoints: [path.join(root, 'src', 'main.ts')], outfile: path.join(out, 'main.cjs') });
await build({ ...common, entryPoints: [path.join(root, 'src', 'preload.ts')], outfile: path.join(out, 'preload.cjs') });

// Интерфейс: собирается заранее (npm run build -w @hotel-manager/ui).
const uiDist = path.resolve(root, 'node_modules', '@hotel-manager', 'ui', 'dist');
const uiOut = path.join(root, 'ui');
if (!process.env.HOTEL_MANAGER_DEV_URL) {
  if (!fs.existsSync(path.join(uiDist, 'index.html'))) {
    console.error('Нет сборки интерфейса: выполните npm run build -w @hotel-manager/ui');
    process.exit(1);
  }
  fs.rmSync(uiOut, { recursive: true, force: true });
  fs.cpSync(uiDist, uiOut, { recursive: true });
}

console.log('Сборка программы для ПК готова');
