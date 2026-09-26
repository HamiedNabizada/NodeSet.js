// Serves the web build (dist/web) for the end-to-end tests:
// node scripts/serve-web.cjs [port]

const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, extname, normalize } = require('node:path');

const root = join(__dirname, '..', 'dist', 'web');
const port = Number(process.argv[2] ?? 3120);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };

createServer(async (req, res) => {
  const path = normalize(join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`dist/web on http://127.0.0.1:${port}/`));
