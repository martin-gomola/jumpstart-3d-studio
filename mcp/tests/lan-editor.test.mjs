import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createLanEditor } from '../server/lan-editor.mjs';

test('LAN listener serves configured CAD proxy host but never routes MCP, including spoofed local Host', async () => {
  let uploads = 0;
  let publicUploads = 0;
  const publicOrigin = new URL('https://cad.example.com');
  const server = createLanEditor({
    origins: ['https://cad.home.example.com', publicOrigin.origin],
    publicOrigin,
    serveStatic: (req, res, path, network, sharing) => {
      assert.equal(network, true);
      assert.equal(sharing !== false, req.headers.host !== publicOrigin.host);
      res.end('editor');
    },
    handleAr: (req, res, path, allowed) => { if (allowed) uploads++; res.end('AR'); },
    handlePublicAr: (req, res, path, allowed) => { if (allowed) publicUploads++; res.end('Public AR'); },
    handleSlicer: (req, res) => res.end('Slicer'),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const call = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { Host: 'cad.home.example.com', ...headers } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal(await call('/?mcp=1'), 200);
    assert.equal(await call('/__mcp/rpc', {}, 'POST'), 404);
    assert.equal(await call('/__mcp/rpc', { Host: `localhost:${server.address().port}` }, 'POST'), 403);
    assert.equal(await call('/__mcp/ar', { Origin: 'https://cad.home.example.com' }, 'POST'), 200);
    assert.equal(uploads, 1);
    assert.equal(await call('/__mcp/ar', { Origin: 'https://attacker.example' }, 'POST'), 403);
    assert.equal(await call('/__mcp/ar', { Origin: 'https://cad.home.example.com', 'Sec-Fetch-Site': 'cross-site' }, 'POST'), 403);
    assert.equal(uploads, 1);
    const publicHeaders = { Host: publicOrigin.host, Origin: publicOrigin.origin };
    assert.equal(await call('/', publicHeaders), 200);
    assert.equal(await call('/__mcp/rpc', publicHeaders, 'POST'), 404);
    assert.equal(await call('/__mcp/ar', publicHeaders, 'POST'), 200);
    assert.equal(await call('/__mcp/ar', { Host: publicOrigin.host }, 'POST'), 403);
    assert.equal(await call('/__mcp/ar', { ...publicHeaders, 'Sec-Fetch-Site': 'cross-site' }, 'POST'), 403);
    assert.equal(await call('/ar/example/model.usdz', publicHeaders), 200);
    assert.equal(await call('/slicer-handoff', publicHeaders, 'POST'), 404);
    assert.equal(await call('/slicer-handoff/example/model.3mf', publicHeaders), 404);
    assert.equal(uploads, 1);
    assert.equal(publicUploads, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
