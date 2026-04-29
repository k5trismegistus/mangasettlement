import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(sourceDir, '..');
export const libraryDir = path.join(appRoot, 'library');
export const thumbnailDir = path.join(appRoot, 'thumbnail');
export const dataDir = path.join(appRoot, 'data');
export const sqlitePath = path.join(dataDir, 'app.sqlite');
export const publicDir = path.join(appRoot, 'dist', 'public');
