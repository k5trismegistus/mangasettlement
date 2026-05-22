import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { sendError } from '../errors.js';
import { sendImage, sendWebp } from '../http/response.js';
import { clampNumber, parseId } from '../http/request.js';
import { createRefreshJob } from '../jobs.js';
import { fallbackImage } from '../media/fallbackImage.js';
import { libraryDir, thumbnailDir } from '../paths.js';
import { findJob } from '../repositories/jobRepository.js';
import {
  findLibrary,
  findLibraryDetail,
  findPage,
  listLibraries,
  listPagesForApi,
  listTags,
  updateLibraryMemo,
  updateLibraryTags
} from '../repositories/libraryRepository.js';
import { contentTypeForEntry, readEntryBuffer } from '../zip.js';

type LibraryListRequestQuery = {
  q?: string;
  tag?: string;
  include_missing?: string;
  limit?: string;
  offset?: string;
};

type IdParams = {
  id: string;
};

type PageParams = {
  id: string;
  page: string;
};

export function registerApiRoutes(app: FastifyInstance): void {
  app.get('/api/libraries', async (request, reply) => {
    const query = request.query as LibraryListRequestQuery;
    reply.send(
      listLibraries(query, {
        limit: clampNumber(query.limit, 50, 1, 200),
        offset: clampNumber(query.offset, 0, 0, 100000)
      })
    );
  });

  app.get('/api/libraries/:id', async (request, reply) => {
    const id = parseId((request.params as IdParams).id);
    const library = findLibraryDetail(id);
    if (!library) {
      sendError(reply, 404, 'NOT_FOUND', 'Library not found');
      return;
    }
    reply.send(library);
  });

  app.get('/api/libraries/:id/pages', async (request, reply) => {
    const id = parseId((request.params as IdParams).id);
    if (!findLibrary(id)) {
      sendError(reply, 404, 'NOT_FOUND', 'Library not found');
      return;
    }
    reply.send(listPagesForApi(id));
  });

  app.get('/api/libraries/:id/pages/:page/image', async (request, reply) => {
    const params = request.params as PageParams;
    const libraryId = parseId(params.id);
    const pageNo = parseId(params.page);
    const library = findLibrary(libraryId);

    if (!library) {
      sendError(reply, 404, 'NOT_FOUND', 'Library not found');
      return;
    }
    if (library.is_missing === 1) {
      sendError(reply, 404, 'LIBRARY_MISSING', 'Library zip file is missing');
      return;
    }

    const page = findPage(libraryId, pageNo);
    if (!page) {
      sendError(reply, 404, 'PAGE_NOT_FOUND', 'Page not found');
      return;
    }

    try {
      const buffer = await readEntryBuffer(path.join(libraryDir, library.file_path), page.entry_name);
      sendImage(reply, buffer, contentTypeForEntry(page.entry_name), 86400);
    } catch (error) {
      request.log.error(error);
      sendError(reply, 500, 'ZIP_READ_ERROR', 'Zip file could not be read');
    }
  });

  app.get('/api/libraries/:id/pages/:page/thumbnail', async (request, reply) => {
    const params = request.params as PageParams;
    const libraryId = parseId(params.id);
    const pageNo = parseId(params.page);
    const library = findLibrary(libraryId);
    const page = findPage(libraryId, pageNo);

    if (!library || !page) {
      sendWebp(reply, await fallbackImage('error'), 3600);
      return;
    }

    const filePath = path.join(thumbnailDir, library.sha256, `${pageNo}.webp`);
    if (page.thumb_status === 'done' && fs.existsSync(filePath)) {
      sendWebp(reply, fs.readFileSync(filePath), 3600);
      return;
    }

    sendWebp(reply, await fallbackImage(page.thumb_status === 'error' ? 'error' : 'placeholder'), 3600);
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
    const id = parseId((request.params as IdParams).id);
    const job = findJob(id);
    if (!job) {
      sendError(reply, 404, 'NOT_FOUND', 'Job not found');
      return;
    }
    reply.send(job);
  });

  app.put('/api/libraries/:id/tags', async (request, reply) => {
    const id = parseId((request.params as IdParams).id);
    if (!findLibrary(id)) {
      sendError(reply, 404, 'NOT_FOUND', 'Library not found');
      return;
    }

    const body = request.body as { tags?: unknown };
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      sendError(reply, 400, 'INVALID_REQUEST', 'tags must be a string array');
      return;
    }

    const tags = updateLibraryTags(id, body.tags);
    reply.send({ id, tags });
  });

  app.put('/api/libraries/:id/memo', async (request, reply) => {
    const id = parseId((request.params as IdParams).id);
    if (!findLibrary(id)) {
      sendError(reply, 404, 'NOT_FOUND', 'Library not found');
      return;
    }

    const body = request.body as { memo?: unknown };
    if (typeof body.memo !== 'string') {
      sendError(reply, 400, 'INVALID_REQUEST', 'memo must be a string');
      return;
    }

    updateLibraryMemo(id, body.memo);
    reply.send({ id, memo: body.memo });
  });

  app.get('/api/tags', async (_request, reply) => {
    reply.send({ tags: listTags() });
  });
}
