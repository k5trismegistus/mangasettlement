import staticPlugin from '@fastify/static';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { registerBasicAuth } from './auth.js';
import { getDb, migrate } from './db.js';
import { sendError } from './errors.js';
import { createRefreshJob, recoverJobs } from './jobs.js';
import { libraryDir, publicDir, thumbnailDir } from './paths.js';
import { contentTypeForEntry, readEntryBuffer } from './zip.js';

dotenv.config();
migrate();
recoverJobs();

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
registerBasicAuth(app);

type LibraryListQuery = {
  q?: string;
  tag?: string;
  include_missing?: string;
  limit?: string;
  offset?: string;
};

app.get('/api/libraries', async (request, reply) => {
  const query = request.query as LibraryListQuery;
  const limit = clampNumber(query.limit, 50, 1, 200);
  const offset = clampNumber(query.offset, 0, 0, 100000);
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.include_missing !== 'true') {
    where.push('l.is_missing = 0');
  }
  if (query.q) {
    where.push('l.file_name LIKE ?');
    params.push(`%${query.q}%`);
  }
  if (query.tag) {
    where.push('EXISTS (SELECT 1 FROM library_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.library_id = l.id AND t.name = ?)');
    params.push(query.tag);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const database = getDb();
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM libraries l ${whereSql}`).get(...params) as { count: number }).count;
  const rows = database
    .prepare(
      `SELECT l.id, l.file_name, l.page_count, l.is_missing, l.updated_at
       FROM libraries l
       ${whereSql}
       ORDER BY l.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<{ id: number; file_name: string; page_count: number; is_missing: number; updated_at: number }>;

  const items = rows.map((row) => ({
    id: row.id,
    file_name: row.file_name,
    page_count: row.page_count,
    cover_thumbnail_url: `/api/libraries/${row.id}/pages/1/thumbnail`,
    tags: getTags(row.id),
    is_missing: row.is_missing === 1,
    updated_at: row.updated_at
  }));

  reply.send({ items, total, limit, offset });
});

app.get('/api/libraries/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const library = getLibrary(id);
  if (!library) {
    sendError(reply, 404, 'NOT_FOUND', 'Library not found');
    return;
  }
  reply.send({ ...library, tags: getTags(id), is_missing: library.is_missing === 1 });
});

app.get('/api/libraries/:id/pages', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!getLibrary(id)) {
    sendError(reply, 404, 'NOT_FOUND', 'Library not found');
    return;
  }
  const pages = getDb()
    .prepare('SELECT page_no, entry_name, thumb_status, width, height FROM pages WHERE library_id = ? ORDER BY page_no')
    .all(id) as Array<{ page_no: number; entry_name: string; thumb_status: string; width: number | null; height: number | null }>;
  reply.send({
    library_id: id,
    pages: pages.map((page) => ({
      ...page,
      thumbnail_url: `/api/libraries/${id}/pages/${page.page_no}/thumbnail`,
      image_url: `/api/libraries/${id}/pages/${page.page_no}/image`
    }))
  });
});

app.get('/api/libraries/:id/pages/:page/image', async (request, reply) => {
  const { id, page } = request.params as { id: string; page: string };
  const library = getLibrary(Number(id));
  if (!library) {
    sendError(reply, 404, 'NOT_FOUND', 'Library not found');
    return;
  }
  if (library.is_missing === 1) {
    sendError(reply, 404, 'LIBRARY_MISSING', 'Library zip file is missing');
    return;
  }
  const pageRow = getDb().prepare('SELECT entry_name FROM pages WHERE library_id = ? AND page_no = ?').get(Number(id), Number(page)) as
    | { entry_name: string }
    | undefined;
  if (!pageRow) {
    sendError(reply, 404, 'PAGE_NOT_FOUND', 'Page not found');
    return;
  }
  try {
    const buffer = await readEntryBuffer(path.join(libraryDir, library.file_path), pageRow.entry_name);
    reply.header('Content-Type', contentTypeForEntry(pageRow.entry_name));
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.send(buffer);
  } catch (error) {
    request.log.error(error);
    sendError(reply, 500, 'ZIP_READ_ERROR', 'Zip file could not be read');
  }
});

app.get('/api/libraries/:id/pages/:page/thumbnail', async (request, reply) => {
  const { id, page } = request.params as { id: string; page: string };
  const library = getLibrary(Number(id));
  const pageRow = getDb().prepare('SELECT thumb_status FROM pages WHERE library_id = ? AND page_no = ?').get(Number(id), Number(page)) as
    | { thumb_status: string }
    | undefined;
  reply.header('Content-Type', 'image/webp');
  reply.header('Cache-Control', 'private, max-age=3600');

  if (!library || !pageRow) {
    reply.send(await fallbackImage('error'));
    return;
  }

  const filePath = path.join(thumbnailDir, library.sha256, `${page}.webp`);
  if (pageRow.thumb_status === 'done' && fs.existsSync(filePath)) {
    reply.send(fs.readFileSync(filePath));
    return;
  }

  reply.send(await fallbackImage(pageRow.thumb_status === 'error' ? 'error' : 'placeholder'));
});

app.post('/api/refresh', async (_request, reply) => {
  const jobId = createRefreshJob();
  if (!jobId) {
    sendError(reply, 409, 'REFRESH_ALREADY_RUNNING', 'Refresh is already running');
    return;
  }
  reply.send({ job_id: jobId, status: 'queued' });
});

app.get('/api/jobs/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const job = getDb().prepare('SELECT id, type, status, progress, message, created_at, started_at, finished_at FROM jobs WHERE id = ?').get(id);
  if (!job) {
    sendError(reply, 404, 'NOT_FOUND', 'Job not found');
    return;
  }
  reply.send(job);
});

app.put('/api/libraries/:id/tags', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!getLibrary(id)) {
    sendError(reply, 404, 'NOT_FOUND', 'Library not found');
    return;
  }
  const body = request.body as { tags?: unknown };
  if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
    sendError(reply, 400, 'INVALID_REQUEST', 'tags must be a string array');
    return;
  }

  const tags = [...new Set(body.tags.map((tag) => tag.trim()).filter(Boolean))];
  const database = getDb();
  const tx = database.transaction(() => {
    database.prepare('DELETE FROM library_tags WHERE library_id = ?').run(id);
    const insertTag = database.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const selectTag = database.prepare('SELECT id FROM tags WHERE name = ?');
    const insertRelation = database.prepare('INSERT INTO library_tags (library_id, tag_id) VALUES (?, ?)');
    for (const tag of tags) {
      insertTag.run(tag);
      const row = selectTag.get(tag) as { id: number };
      insertRelation.run(id, row.id);
    }
  });
  tx();
  reply.send({ id, tags });
});

app.put('/api/libraries/:id/memo', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!getLibrary(id)) {
    sendError(reply, 404, 'NOT_FOUND', 'Library not found');
    return;
  }
  const body = request.body as { memo?: unknown };
  if (typeof body.memo !== 'string') {
    sendError(reply, 400, 'INVALID_REQUEST', 'memo must be a string');
    return;
  }
  getDb().prepare('UPDATE libraries SET memo = ?, updated_at = strftime("%s", "now") WHERE id = ?').run(body.memo, id);
  reply.send({ id, memo: body.memo });
});

app.get('/api/tags', async (_request, reply) => {
  const tags = getDb().prepare('SELECT name FROM tags ORDER BY name').all() as Array<{ name: string }>;
  reply.send({ tags: tags.map((tag) => tag.name) });
});

if (fs.existsSync(publicDir)) {
  app.register(staticPlugin, { root: publicDir, prefix: '/' });
}

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    sendError(reply, 404, 'NOT_FOUND', 'Not found');
    return;
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    reply.type('text/html').send(fs.readFileSync(indexPath, 'utf8'));
    return;
  }
  reply.type('text/plain').send('Frontend is not built. Run npm run build.');
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

function getLibrary(id: number): (Record<string, unknown> & { sha256: string; file_path: string; is_missing: number }) | undefined {
  return getDb().prepare('SELECT * FROM libraries WHERE id = ?').get(id) as
    | (Record<string, unknown> & { sha256: string; file_path: string; is_missing: number })
    | undefined;
}

function getTags(libraryId: number): string[] {
  const rows = getDb()
    .prepare('SELECT t.name FROM tags t JOIN library_tags lt ON lt.tag_id = t.id WHERE lt.library_id = ? ORDER BY t.name')
    .all(libraryId) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function clampNumber(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

const fallbackCache = new Map<string, Buffer>();
async function fallbackImage(type: 'placeholder' | 'error'): Promise<Buffer> {
  const cached = fallbackCache.get(type);
  if (cached) return cached;
  const background = type === 'placeholder' ? '#f1f5f9' : '#fee2e2';
  const foreground = type === 'placeholder' ? '#64748b' : '#b91c1c';
  const label = type === 'placeholder' ? 'NO IMAGE' : 'ERROR';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${background}"/><text x="150" y="158" text-anchor="middle" font-family="sans-serif" font-size="24" fill="${foreground}">${label}</text></svg>`;
  const buffer = await sharp(Buffer.from(svg)).webp().toBuffer();
  fallbackCache.set(type, buffer);
  return buffer;
}
