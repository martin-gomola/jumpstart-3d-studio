import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, buildPlugin } from '../packaging/plugin.mjs';
import { installPlugin, managedRegistration } from '../packaging/install.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jumpstart-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['mcp/plugin', 'mcp/server', '.agents/plugins']) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await cp(join(ROOT, path), join(root, path), { recursive: true });
  }
  await cp(join(ROOT, 'package.json'), join(root, 'package.json'));
  return root;
}
const oldEntry = root => ({ name: 'jumpstart', enabled: true, transport: { type: 'stdio', command: '/bin/node', args: [join(root, 'mcp/server/stdio-proxy.mjs')] } });

test('portable bundle is complete and stable, and excludes evaluation fixtures', async t => {
  const root = await fixture(t), first = await buildPlugin({ root }), second = await buildPlugin({ root });
  assert.equal(first.version, second.version);
  const { version } = JSON.parse(await readFile(join(root, 'package.json')));
  assert.equal(first.version, version);
  assert.equal(JSON.parse(await readFile(join(first.pluginRoot, '.codex-plugin/plugin.json'))).version, version);
  assert.ok(!first.files.some(path => path.includes('/tests/')));
  const config = JSON.parse(await readFile(join(first.pluginRoot, '.mcp.json')));
  assert.equal(config.mcpServers.jumpstart.command, 'node');
  assert.equal(config.mcpServers.jumpstart.args[0], 'server/stdio-proxy.mjs');
  assert.ok((await readFile(join(first.pluginRoot, 'skills/3d-model/SKILL.md'), 'utf8')).includes('name: 3d-model'));
  for (const name of ['step-parts', 'woodwork-joints-3d', 'bambu-handoff', 'print-troubleshooter']) assert.ok((await readFile(join(first.pluginRoot, `skills/${name}/SKILL.md`), 'utf8')).includes(`name: ${name}`));
  const skill = join(root, 'mcp/plugin/skills/3d-model/SKILL.md');
  await writeFile(skill, (await readFile(skill)) + '\nUpdated instructions.\n');
  assert.equal((await buildPlugin({ root })).version, version);
});

test('local bundle pins Node; unsafe output and stale runtime are rejected', async t => {
  const root = await fixture(t), local = await buildPlugin({ root, nodePath: '/bin/node' });
  assert.equal(JSON.parse(await readFile(join(local.pluginRoot, '.mcp.json'))).mcpServers.jumpstart.command, '/bin/node');
  await assert.rejects(buildPlugin({ root, output: join(root, 'mcp') }), /owned build/);
  await writeFile(join(root, 'mcp/plugin/server/stdio-proxy.mjs'), 'stale');
  await assert.rejects(buildPlugin({ root }), /stale/);
});

test('installer rebuilds marketplace and reinstalls directly without listing all plugins or MCP servers', async t => {
  const root = await fixture(t), calls = [];
  const marketplaceRoot = join(root, 'build/codex-marketplace');
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'get') {
      throw new Error("codex mcp get jumpstart failed: Error: No MCP server named 'jumpstart' found.");
    }
    if (args[1] === 'marketplace' && args[2] === 'list') {
      assert.ok(existsSync(join(marketplaceRoot, '.agents/plugins/marketplace.json')));
      return { marketplaces: [{ name: 'jumpstart-3d', root: marketplaceRoot }] };
    }
    if (args[0] === 'plugin' && args[1] === 'add') {
      const version = JSON.parse(readFileSync(join(marketplaceRoot, 'mcp/plugin/.codex-plugin/plugin.json'), 'utf8')).version;
      return { pluginId: 'jumpstart-3d@jumpstart-3d', version };
    }
    return {};
  };
  const result = await installPlugin({ root, run, nodePath: '/bin/node' });
  assert.equal(result.id, 'jumpstart-3d@jumpstart-3d');
  assert.equal(result.migrated, false);
  assert.deepEqual(calls, [
    'mcp get jumpstart --json',
    'plugin marketplace list --json',
    'plugin add jumpstart-3d@jumpstart-3d --json',
  ]);
});

test('custom standalone settings are never automatically migrated', () => {
  const entry = oldEntry(ROOT);
  assert.ok(managedRegistration(entry));
  for (const extra of [{ enabled: false }, { enabled_tools: ['one'] }, { tool_timeout_sec: 120 }]) assert.equal(managedRegistration({ ...entry, ...extra }), false);
  assert.equal(managedRegistration({ ...entry, transport: { ...entry.transport, env: { SECRET: 'custom' } } }), false);
});

test('reinstalling an existing cached plugin entry skips migration without calling plugin list', async t => {
  const root = await fixture(t), calls = [];
  const marketplaceRoot = join(root, 'build/codex-marketplace');
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'get') {
      return {
        name: 'jumpstart',
        enabled: true,
        transport: { type: 'stdio', command: '/bin/node', args: ['server/stdio-proxy.mjs'], cwd: '/Users/me/.codex/plugins/cache/jumpstart-3d/jumpstart-3d/0.1.3/.' },
      };
    }
    if (args[1] === 'marketplace' && args[2] === 'list') return { marketplaces: [{ name: 'jumpstart-3d', root: marketplaceRoot }] };
    if (args[0] === 'plugin' && args[1] === 'add') {
      const version = JSON.parse(readFileSync(join(marketplaceRoot, 'mcp/plugin/.codex-plugin/plugin.json'), 'utf8')).version;
      return { pluginId: 'jumpstart-3d@jumpstart-3d', version };
    }
    return {};
  };
  const result = await installPlugin({ root, run, nodePath: '/bin/node' });
  assert.equal(result.migrated, false);
  assert.ok(!calls.includes('mcp remove jumpstart'));
  assert.ok(!calls.some(call => call.startsWith('plugin list')));
});

test('installer removes old registration only after verified plugin installation', async t => {
  const root = await fixture(t), calls = [];
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'get') return oldEntry(root);
    if (args[1] === 'marketplace' && args[2] === 'list') return { marketplaces: [] };
    if (args[0] === 'plugin' && args[1] === 'add') {
      const version = JSON.parse(readFileSync(join(root, 'build/codex-marketplace/mcp/plugin/.codex-plugin/plugin.json'), 'utf8')).version;
      return { pluginId: 'jumpstart-3d@jumpstart-3d', version };
    }
    return {};
  };
  assert.equal((await installPlugin({ root, run })).migrated, true);
  assert.equal(calls.at(-1), 'mcp remove jumpstart');
});

test('failed plugin verification retains standalone registration', async t => {
  const root = await fixture(t), calls = [];
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'get') return oldEntry(root);
    if (args[1] === 'marketplace' && args[2] === 'list') return { marketplaces: [] };
    if (args[0] === 'plugin' && args[1] === 'add') return {};
    return {};
  };
  await assert.rejects(installPlugin({ root, run }), /retained/);
  assert.ok(!calls.includes('mcp remove jumpstart'));
});
