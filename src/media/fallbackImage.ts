import sharp from 'sharp';

const fallbackCache = new Map<string, Buffer>();

export async function fallbackImage(type: 'placeholder' | 'error'): Promise<Buffer> {
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
