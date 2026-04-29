import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import sharp from 'sharp';
import { getDb, now } from './db.js';
import { libraryDir, thumbnailDir } from './paths.js';
import { listImageEntries, readEntryBuffer } from './zip.js';

type LibraryRow = {
  id: number;
  sha256: string;
  file_name: string;
  file_path: string;
  is_missing: number;
};

type PageRow = {
  page_no: number;
  entry_name: string;
  thumb_status: string;
};

let queueRunning = false;

export function recoverJobs(): void {
  const database = getDb();
  database
    .prepare(
      "UPDATE jobs SET status = 'error', message = 'Interrupted by application shutdown', finished_at = ? WHERE status = 'running'"
    )
    .run(now());
  database.prepare("UPDATE jobs SET status = 'error', message = 'Refresh was interrupted', finished_at = ? WHERE status = 'queued' AND type = 'refresh'").run(now());
  runQueue();
}

export function createRefreshJob(): number | undefined {
  const database = getDb();
  const running = database
    .prepare("SELECT id FROM jobs WHERE type = 'refresh' AND status IN ('queued', 'running') LIMIT 1")
    .get();
  if (running) return undefined;

  const result = database
    .prepare("INSERT INTO jobs (type, status, progress, message, created_at) VALUES ('refresh', 'queued', 0, 'Queued', ?)")
    .run(now());
  runQueue();
  return Number(result.lastInsertRowid);
}

export function createThumbnailJob(libraryId: number): number {
  const database = getDb();
  const result = database
    .prepare(
      "INSERT INTO jobs (type, target_id, status, progress, message, created_at) VALUES ('thumbnail_generate', ?, 'queued', 0, 'Queued', ?)"
    )
    .run(libraryId, now());
  runQueue();
  return Number(result.lastInsertRowid);
}

export function runQueue(): void {
  if (queueRunning) return;
  queueRunning = true;
  void processQueue().finally(() => {
    queueRunning = false;
  });
}

async function processQueue(): Promise<void> {
  const database = getDb();
  while (true) {
    const job = database
      .prepare(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY CASE type WHEN 'refresh' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
      )
      .get() as { id: number; type: string; target_id: number | null } | undefined;

    if (!job) return;

    database
      .prepare("UPDATE jobs SET status = 'running', started_at = ?, message = ? WHERE id = ?")
      .run(now(), job.type === 'refresh' ? 'Scanning library directory' : 'Generating thumbnails', job.id);

    try {
      if (job.type === 'refresh') {
        await refreshLibrary(job.id);
      } else if (job.type === 'thumbnail_generate' && job.target_id) {
        await generateThumbnails(job.id, job.target_id);
      }
      database.prepare("UPDATE jobs SET status = 'done', progress = 100, message = 'Completed', finished_at = ? WHERE id = ?").run(now(), job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      database.prepare("UPDATE jobs SET status = 'error', message = ?, finished_at = ? WHERE id = ?").run(message, now(), job.id);
      console.error(`[job:${job.id}]`, error);
    }
  }
}

async function refreshLibrary(jobId: number): Promise<void> {
  const database = getDb();
  fs.mkdirSync(libraryDir, { recursive: true });
  const zipPaths = await findZipFiles(libraryDir);
  const seenLibraryIds = new Set<number>();
  let changedCount = 0;

  for (let index = 0; index < zipPaths.length; index += 1) {
    const absolutePath = zipPaths[index];
    const relativePath = path.relative(libraryDir, absolutePath);
    const stat = fs.statSync(absolutePath);
    const mtime = Math.floor(stat.mtimeMs);
    const existingByPath = database.prepare('SELECT * FROM libraries WHERE file_path = ?').get(relativePath) as LibraryRow & {
      file_size: number;
      file_mtime: number;
    } | undefined;

    updateJob(jobId, Math.floor((index / Math.max(zipPaths.length, 1)) * 70), `Scanning: ${relativePath}`);

    if (existingByPath && existingByPath.file_size === stat.size && existingByPath.file_mtime === mtime) {
      database.prepare('UPDATE libraries SET is_missing = 0, updated_at = ? WHERE id = ?').run(now(), existingByPath.id);
      seenLibraryIds.add(existingByPath.id);
      continue;
    }

    const sha256 = await hashFile(absolutePath);
    const imageEntries = await listImageEntries(absolutePath);
    const existingByHash = database.prepare('SELECT * FROM libraries WHERE sha256 = ?').get(sha256) as LibraryRow | undefined;
    const libraryId = upsertLibrary({
      existingId: existingByHash?.id ?? existingByPath?.id,
      sha256,
      fileName: path.basename(relativePath),
      filePath: relativePath,
      fileSize: stat.size,
      fileMtime: mtime,
      pageCount: imageEntries.length,
      coverPage: imageEntries.length > 0 ? 1 : null
    });

    seenLibraryIds.add(libraryId);

    if (!existingByHash || existingByPath?.sha256 !== sha256) {
      recreatePages(libraryId, imageEntries);
      removeThumbnailDir(sha256);
      createThumbnailJob(libraryId);
      changedCount += 1;
    }
  }

  const rows = database.prepare('SELECT id, file_path FROM libraries WHERE is_missing = 0').all() as Array<{ id: number; file_path: string }>;
  for (const row of rows) {
    if (!seenLibraryIds.has(row.id) && !fs.existsSync(path.join(libraryDir, row.file_path))) {
      database.prepare('UPDATE libraries SET is_missing = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
    }
  }

  updateJob(jobId, 100, `Completed. Changed libraries: ${changedCount}`);
}

function upsertLibrary(input: {
  existingId?: number;
  sha256: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileMtime: number;
  pageCount: number;
  coverPage: number | null;
}): number {
  const database = getDb();
  const timestamp = now();

  if (input.existingId) {
    database
      .prepare(
        `UPDATE libraries
         SET sha256 = ?, file_name = ?, file_path = ?, file_size = ?, file_mtime = ?, page_count = ?, cover_page = ?, is_missing = 0, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.sha256,
        input.fileName,
        input.filePath,
        input.fileSize,
        input.fileMtime,
        input.pageCount,
        input.coverPage,
        timestamp,
        input.existingId
      );
    return input.existingId;
  }

  const result = database
    .prepare(
      `INSERT INTO libraries (sha256, file_name, file_path, file_size, file_mtime, page_count, cover_page, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.sha256, input.fileName, input.filePath, input.fileSize, input.fileMtime, input.pageCount, input.coverPage, timestamp, timestamp);
  return Number(result.lastInsertRowid);
}

function recreatePages(libraryId: number, entries: Array<{ name: string }>): void {
  const database = getDb();
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM pages WHERE library_id = ?').run(libraryId);
    const insert = database.prepare(
      'INSERT INTO pages (library_id, page_no, entry_name, width, height, thumb_status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (let index = 0; index < entries.length; index += 1) {
      insert.run(libraryId, index + 1, entries[index].name, null, null, 'queued');
    }
  });
  transaction();
}

async function generateThumbnails(jobId: number, libraryId: number): Promise<void> {
  const database = getDb();
  const library = database.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId) as LibraryRow | undefined;
  if (!library || library.is_missing) return;

  const zipPath = path.join(libraryDir, library.file_path);
  const pages = database
    .prepare("SELECT page_no, entry_name, thumb_status FROM pages WHERE library_id = ? AND thumb_status != 'done' ORDER BY page_no")
    .all(libraryId) as PageRow[];
  const outputDir = path.join(thumbnailDir, library.sha256);
  fs.mkdirSync(outputDir, { recursive: true });

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    updateJob(jobId, Math.floor((index / Math.max(pages.length, 1)) * 100), `Generating thumbnails: ${index + 1}/${pages.length}`);
    try {
      const buffer = await readEntryBuffer(zipPath, page.entry_name);
      const size = imageSize(buffer);
      database
        .prepare('UPDATE pages SET width = ?, height = ? WHERE library_id = ? AND page_no = ?')
        .run(size.width ?? null, size.height ?? null, libraryId, page.page_no);
      await sharp(buffer).resize({ width: 300, height: 300, fit: 'inside', withoutEnlargement: true }).webp().toFile(path.join(outputDir, `${page.page_no}.webp`));
      database.prepare("UPDATE pages SET thumb_status = 'done' WHERE library_id = ? AND page_no = ?").run(libraryId, page.page_no);
    } catch (error) {
      database.prepare("UPDATE pages SET thumb_status = 'error' WHERE library_id = ? AND page_no = ?").run(libraryId, page.page_no);
      console.error(`[thumbnail:${libraryId}:${page.page_no}]`, error);
    }
  }
}

function updateJob(jobId: number, progress: number, message: string): void {
  getDb().prepare('UPDATE jobs SET progress = ?, message = ? WHERE id = ?').run(progress, message, jobId);
}

async function findZipFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  if (!fs.existsSync(root)) return result;

  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await findZipFiles(absolute)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
      result.push(absolute);
    }
  }
  return result;
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function removeThumbnailDir(sha256: string): void {
  fs.rmSync(path.join(thumbnailDir, sha256), { recursive: true, force: true });
}
