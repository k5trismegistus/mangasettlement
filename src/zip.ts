import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import iconv from 'iconv-lite';
import yauzl from 'yauzl';

const openZip = promisify<string, yauzl.Options, yauzl.ZipFile>(yauzl.open);

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const collator = new Intl.Collator('ja-JP', { numeric: true, sensitivity: 'base' });

export type ZipImageEntry = {
  name: string;
  uncompressedSize: number;
};

export async function listImageEntries(zipPath: string): Promise<ZipImageEntry[]> {
  const zip = await openZip(zipPath, { lazyEntries: true, decodeStrings: false });
  const entries: ZipImageEntry[] = [];

  return new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = decodeEntryName(entry);
      if (!name.endsWith('/') && imageExtensions.has(path.extname(name).toLowerCase())) {
        entries.push({ name, uncompressedSize: entry.uncompressedSize });
      }
      zip.readEntry();
    });
    zip.on('end', () => {
      zip.close();
      entries.sort((a, b) => collator.compare(a.name, b.name));
      resolve(entries);
    });
    zip.on('error', reject);
  });
}

export async function readEntryBuffer(zipPath: string, entryName: string): Promise<Buffer> {
  const zip = await openZip(zipPath, { lazyEntries: true, decodeStrings: false });

  return new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = decodeEntryName(entry);
      if (name !== entryName) {
        zip.readEntry();
        return;
      }

      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) {
          reject(streamError ?? new Error('Zip entry stream is empty'));
          return;
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          zip.close();
          resolve(Buffer.concat(chunks));
        });
        stream.on('error', reject);
      });
    });
    zip.on('end', () => {
      zip.close();
      reject(new Error(`Entry not found: ${entryName}`));
    });
    zip.on('error', reject);
  });
}

export function contentTypeForEntry(entryName: string): string {
  const ext = path.extname(entryName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  return 'application/octet-stream';
}

export function zipExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function decodeEntryName(entry: yauzl.Entry): string {
  const raw = Buffer.isBuffer(entry.fileName) ? entry.fileName : Buffer.from(entry.fileName);
  const isUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0;
  return isUtf8 ? raw.toString('utf8') : iconv.decode(raw, 'cp932');
}
