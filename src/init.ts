import fs from 'node:fs';
import { migrate } from './db.js';
import { dataDir, libraryDir, thumbnailDir } from './paths.js';

for (const dir of [libraryDir, thumbnailDir, dataDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

migrate();
console.log('Initialized library/, thumbnail/, data/, and SQLite schema.');
