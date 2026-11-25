import { createServer } from 'node:http';

// A distinct listener prevents LAN clients from reaching MCP by spoofing Host/Origin.
export function createLanEditor({ origins, serveStatic, handleAr, handleSlicer }) {
  const allowed = new Set(origins);
  const hosts = new Set(origins.map(origin => new URL(origin).host));
  return createServer((req, res) => {
    const reject = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end(message); };
    if (!hosts.has(req.headers.host)) return reject(403, 'Unrecognized editor address');
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (handleSlicer && (path === '/slicer-handoff' || path.startsWith('/slicer-handoff/'))) {
      const origin = req.headers.origin;
      const allowUpload = allowed.has(origin) && new URL(origin).host === req.headers.host &&
        (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
      void handleSlicer(req, res, path, allowUpload); return;
    }
    if (path === '/__mcp/ar') {
      const origin = req.headers.origin;
      if (!allowed.has(origin) || new URL(origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') return reject(403, 'Same-origin editor upload required');
      void handleAr(req, res, path, true); return;
    }
    if (path.startsWith('/__mcp/')) return reject(404, 'MCP is available through localhost only');
    if (path.startsWith('/ar/')) { void handleAr(req, res, path); return; }
    void serveStatic(req, res, path, true);
  });
}
