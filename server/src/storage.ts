import { randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentInfo, PageInfo } from '@e-sign/shared';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentMeta = Omit<DocumentInfo, 'signed'> & { signedAt?: string };
type PdfFile = 'original.pdf' | 'signed.pdf';

export function isDocumentId(id: string): boolean {
  return UUID_V4.test(id);
}

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function readMeta(directory: string): Promise<DocumentMeta | undefined> {
  const data = await readOptional(join(directory, 'meta.json'));
  return data && JSON.parse(data.toString('utf8')) as DocumentMeta;
}

function documentInfo(meta: DocumentMeta): DocumentInfo {
  const { signedAt, ...info } = meta;
  return { ...info, signed: signedAt !== undefined };
}

export class DocumentStorage {
  // Выдача подписанного PDF ждёт завершения записи всех файлов подписи.
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly dataDir: string) {}

  private async inOrder<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    this.pending.set(id, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(id) === next) this.pending.delete(id);
    }
  }

  async create(name: string, bytes: Buffer, pages: PageInfo[]): Promise<DocumentInfo> {
    const id = randomUUID();
    const directory = join(this.dataDir, id);
    const meta: DocumentMeta = {
      id,
      name,
      sizeBytes: bytes.length,
      pageCount: pages.length,
      pages,
      createdAt: new Date().toISOString(),
    };
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(directory, { mode: 0o700 });
    try {
      await writeFile(join(directory, 'original.pdf'), bytes);
      const temporaryMeta = join(directory, 'meta.json.tmp');
      await writeFile(temporaryMeta, JSON.stringify(meta));
      await rename(temporaryMeta, join(directory, 'meta.json'));
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return documentInfo(meta);
  }

  async get(id: string): Promise<DocumentInfo | undefined> {
    if (!isDocumentId(id)) return;
    const meta = await readMeta(join(this.dataDir, id));
    return meta && documentInfo(meta);
  }

  async readPdf(id: string, file: PdfFile): Promise<{ bytes: Buffer; name: string } | undefined> {
    if (!isDocumentId(id)) return;
    const directory = join(this.dataDir, id);
    const read = async () => {
      const meta = await readMeta(directory);
      if (!meta || (file === 'signed.pdf' && !meta.signedAt)) return;
      const bytes = await readOptional(join(directory, file));
      return bytes && { bytes, name: meta.name };
    };
    return file === 'signed.pdf' ? this.inOrder(id, read) : read();
  }

  async saveSignature(
    id: string,
    pdf: Uint8Array,
    png: Uint8Array,
    signDataBase64: string | undefined,
  ): Promise<DocumentInfo | undefined> {
    if (!isDocumentId(id)) return;
    return this.inOrder(id, async () => {
      const directory = join(this.dataDir, id);
      const meta = await readMeta(directory);
      if (!meta) return;
      meta.signedAt = new Date().toISOString();

      const temporary = await mkdtemp(join(directory, '.signature-'));
      const files = [
        { name: 'signed.pdf', data: pdf },
        { name: 'signature.png', data: png },
        { name: 'signdata.b64', data: signDataBase64 },
      ];
      const backups = new Map<string, string>();
      const published: string[] = [];
      try {
        for (const { name, data } of files) {
          if (data !== undefined) await writeFile(join(temporary, name), data);
          const backup = join(temporary, `${name}.previous`);
          try {
            await link(join(directory, name), backup);
            backups.set(name, backup);
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
        await writeFile(join(temporary, 'meta.json'), JSON.stringify(meta));

        for (const { name, data } of files) {
          const target = join(directory, name);
          if (data !== undefined) await rename(join(temporary, name), target);
          else await rm(target, { force: true });
          published.push(name);
        }
        await rename(join(temporary, 'meta.json'), join(directory, 'meta.json'));
      } catch (error) {
        for (const name of published.reverse()) {
          const backup = backups.get(name);
          if (backup) await rename(backup, join(directory, name));
          else await rm(join(directory, name), { force: true });
        }
        throw error;
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      return documentInfo(meta);
    });
  }
}
