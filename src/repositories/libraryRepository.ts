import { getDb, now } from '../db.js';

export type LibraryRow = {
  id: number;
  sha256: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_mtime: number;
  page_count: number;
  cover_page: number | null;
  memo: string;
  is_missing: number;
  created_at: number;
  updated_at: number;
};

export type LibraryDetail = Omit<LibraryRow, 'is_missing'> & {
  tags: string[];
  is_missing: boolean;
};

export type PageRow = {
  page_no: number;
  entry_name: string;
  thumb_status: string;
  width: number | null;
  height: number | null;
};

export type LibraryListQuery = {
  q?: string;
  tag?: string;
  include_missing?: string;
};

export type Pagination = {
  limit: number;
  offset: number;
};

export function listLibraries(query: LibraryListQuery, pagination: Pagination): {
  items: Array<{
    id: number;
    file_name: string;
    page_count: number;
    cover_thumbnail_url: string;
    tags: string[];
    is_missing: boolean;
    updated_at: number;
  }>;
  total: number;
  limit: number;
  offset: number;
} {
  const { whereSql, params } = buildLibraryWhere(query);
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
    .all(...params, pagination.limit, pagination.offset) as Array<{
    id: number;
    file_name: string;
    page_count: number;
    is_missing: number;
    updated_at: number;
  }>;

  const tagsByLibraryId = getTagsByLibraryIds(rows.map((row) => row.id));

  return {
    items: rows.map((row) => ({
      id: row.id,
      file_name: row.file_name,
      page_count: row.page_count,
      cover_thumbnail_url: `/api/libraries/${row.id}/pages/1/thumbnail`,
      tags: tagsByLibraryId.get(row.id) ?? [],
      is_missing: row.is_missing === 1,
      updated_at: row.updated_at
    })),
    total,
    limit: pagination.limit,
    offset: pagination.offset
  };
}

export function findLibrary(id: number): LibraryRow | undefined {
  return getDb().prepare('SELECT * FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined;
}

export function findLibraryDetail(id: number): LibraryDetail | undefined {
  const library = findLibrary(id);
  if (!library) return undefined;
  return {
    ...library,
    tags: getTags(id),
    is_missing: library.is_missing === 1
  };
}

export function listPages(libraryId: number): PageRow[] {
  return getDb()
    .prepare('SELECT page_no, entry_name, thumb_status, width, height FROM pages WHERE library_id = ? ORDER BY page_no')
    .all(libraryId) as PageRow[];
}

export function findPage(libraryId: number, pageNo: number): PageRow | undefined {
  return getDb()
    .prepare('SELECT page_no, entry_name, thumb_status, width, height FROM pages WHERE library_id = ? AND page_no = ?')
    .get(libraryId, pageNo) as PageRow | undefined;
}

export function listPagesForApi(libraryId: number): {
  library_id: number;
  pages: Array<PageRow & { thumbnail_url: string; image_url: string }>;
} {
  return {
    library_id: libraryId,
    pages: listPages(libraryId).map((page) => ({
      ...page,
      thumbnail_url: `/api/libraries/${libraryId}/pages/${page.page_no}/thumbnail`,
      image_url: `/api/libraries/${libraryId}/pages/${page.page_no}/image`
    }))
  };
}

export function updateLibraryTags(libraryId: number, tags: string[]): string[] {
  const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  const database = getDb();
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM library_tags WHERE library_id = ?').run(libraryId);
    const insertTag = database.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const selectTag = database.prepare('SELECT id FROM tags WHERE name = ?');
    const insertRelation = database.prepare('INSERT INTO library_tags (library_id, tag_id) VALUES (?, ?)');

    for (const tag of normalizedTags) {
      insertTag.run(tag);
      const row = selectTag.get(tag) as { id: number };
      insertRelation.run(libraryId, row.id);
    }
  });
  transaction();
  return normalizedTags;
}

export function updateLibraryMemo(libraryId: number, memo: string): void {
  getDb().prepare('UPDATE libraries SET memo = ?, updated_at = ? WHERE id = ?').run(memo, now(), libraryId);
}

export function getTags(libraryId: number): string[] {
  const rows = getDb()
    .prepare('SELECT t.name FROM tags t JOIN library_tags lt ON lt.tag_id = t.id WHERE lt.library_id = ? ORDER BY t.name')
    .all(libraryId) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function getTagsByLibraryIds(libraryIds: number[]): Map<number, string[]> {
  const tagsByLibraryId = new Map<number, string[]>();
  if (libraryIds.length === 0) return tagsByLibraryId;

  const placeholders = libraryIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT lt.library_id, t.name
       FROM library_tags lt
       JOIN tags t ON t.id = lt.tag_id
       WHERE lt.library_id IN (${placeholders})
       ORDER BY t.name`
    )
    .all(...libraryIds) as Array<{ library_id: number; name: string }>;

  for (const row of rows) {
    const tags = tagsByLibraryId.get(row.library_id) ?? [];
    tags.push(row.name);
    tagsByLibraryId.set(row.library_id, tags);
  }

  return tagsByLibraryId;
}

export function listTags(): string[] {
  const tags = getDb().prepare('SELECT name FROM tags ORDER BY name').all() as Array<{ name: string }>;
  return tags.map((tag) => tag.name);
}

function buildLibraryWhere(query: LibraryListQuery): { whereSql: string; params: unknown[] } {
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

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}
