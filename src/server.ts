import staticPlugin from '@fastify/static';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { registerBasicAuth } from './auth.js';
import { migrate } from './db.js';
import { sendError } from './errors.js';
import { recoverJobs } from './jobs.js';
import { publicDir } from './paths.js';
import { registerApiRoutes } from './routes/api.js';

dotenv.config();
migrate();
recoverJobs();

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
registerBasicAuth(app);
registerApiRoutes(app);
registerFrontend(app);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

function registerFrontend(fastify: typeof app): void {
  if (fs.existsSync(publicDir)) {
    fastify.register(staticPlugin, { root: publicDir, prefix: '/' });
  }

  fastify.setNotFoundHandler((request, reply) => {
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
}
