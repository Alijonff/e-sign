// Крошечный статический сервер для проверочной страницы модуля (без зависимостей).
// Запуск: node crm-module/serve.mjs  (порт из PORT, по умолчанию 8080)
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('./site/', import.meta.url)));
const port = Number(process.env.PORT) || 8080;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt']);
const cache = new Map();

async function load(file) {
  const info = await stat(file);
  const key = `${file}:${info.mtimeMs}:${info.size}`;
  let entry = cache.get(file);
  if (!entry || entry.key !== key) {
    const body = await readFile(file);
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    const ext = extname(file).toLowerCase();
    entry = { key, body, etag, gzip: compressible.has(ext) ? gzipSync(body) : undefined };
    cache.set(file, entry);
  }
  return entry;
}

const server = createServer(async (request, response) => {
  const send = (status, body, headers = {}) => {
    response.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/health') return send(200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });

    let relative;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      return send(400, 'Bad Request');
    }
    let file = resolve(join(root, relative));
    if (file !== root && !file.startsWith(root + sep)) return send(404, 'Not Found');
    if ((await stat(file).catch(() => undefined))?.isDirectory()) file = join(file, 'index.html');

    const entry = await load(file).catch(() => undefined);
    if (!entry) return send(404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });

    const ext = extname(file).toLowerCase();
    const headers = {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: entry.etag,
      Vary: 'Accept-Encoding',
    };
    if (request.headers['if-none-match'] === entry.etag) return send(304, undefined, headers);
    if (entry.gzip && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
      return send(200, entry.gzip, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': entry.gzip.length });
    }
    return send(200, entry.body, { ...headers, 'Content-Length': entry.body.length });
  } catch (error) {
    console.error(error);
    return send(500, 'Internal Server Error');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`crm-module: http://0.0.0.0:${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
