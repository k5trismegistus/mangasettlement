import { FastifyReply } from 'fastify';

export function sendImage(reply: FastifyReply, buffer: Buffer, contentType: string, maxAgeSeconds: number): void {
  // 画像レスポンスのキャッシュ方針をエンドポイント間で揃える。
  reply.header('Content-Type', contentType);
  reply.header('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  reply.send(buffer);
}

export function sendWebp(reply: FastifyReply, buffer: Buffer, maxAgeSeconds: number): void {
  sendImage(reply, buffer, 'image/webp', maxAgeSeconds);
}
