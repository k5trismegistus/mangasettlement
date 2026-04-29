import { getDb } from '../db.js';

export type JobRow = {
  id: number;
  type: string;
  status: string;
  progress: number;
  message: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export function findJob(id: number): JobRow | undefined {
  return getDb()
    .prepare('SELECT id, type, status, progress, message, created_at, started_at, finished_at FROM jobs WHERE id = ?')
    .get(id) as JobRow | undefined;
}
