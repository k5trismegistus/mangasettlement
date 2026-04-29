import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { sendError } from './errors.js';

export function registerBasicAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const user = process.env.BASIC_AUTH_USER;
    const password = process.env.BASIC_AUTH_PASSWORD;

    if (!user || !password) {
      reply.header('WWW-Authenticate', 'Basic realm="mangasettlement"');
      sendError(reply, 401, 'AUTH_REQUIRED', 'Basic auth credentials are not configured');
      return;
    }

    const header = request.headers.authorization;
    if (!header?.startsWith('Basic ')) {
      reply.header('WWW-Authenticate', 'Basic realm="mangasettlement"');
      sendError(reply, 401, 'AUTH_REQUIRED', 'Authentication required');
      return;
    }

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const actualUser = decoded.slice(0, separator);
    const actualPassword = decoded.slice(separator + 1);

    // タイミング差を小さくするため固定長比較に寄せる。
    const expected = Buffer.from(`${user}:${password}`);
    const actual = Buffer.from(`${actualUser}:${actualPassword}`);
    if (expected.length !== actual.length || !cryptoSafeEqual(expected, actual)) {
      reply.header('WWW-Authenticate', 'Basic realm="mangasettlement"');
      sendError(reply, 401, 'AUTH_REQUIRED', 'Authentication required');
    }
  });
}

function cryptoSafeEqual(a: Buffer, b: Buffer): boolean {
  return crypto.timingSafeEqual(a, b);
}
