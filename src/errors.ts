import { FastifyReply } from 'fastify';

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'LIBRARY_MISSING'
  | 'PAGE_NOT_FOUND'
  | 'ZIP_READ_ERROR'
  | 'IMAGE_READ_ERROR'
  | 'REFRESH_ALREADY_RUNNING'
  | 'INTERNAL_ERROR';

export function sendError(reply: FastifyReply, status: number, code: ErrorCode, message: string): void {
  reply.status(status).send({ error: { code, message } });
}
