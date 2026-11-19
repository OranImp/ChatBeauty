import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.cwd(), 'dist-electron');
for (const name of ['main', 'preload']) {
  const src = path.join(outDir, `${name}.js`);
  const dst = path.join(outDir, `${name}.cjs`);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
  }
}
