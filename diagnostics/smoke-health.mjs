#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const cli = spawnSync(process.execPath, ['cua-local.mjs', '--health'], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 45000,
});

if (cli.status !== 0) {
  console.error(cli.stderr || cli.stdout);
  throw new Error('CLI health check failed');
}

const cliHealth = JSON.parse(cli.stdout);
console.log(`CLI health ok: ${cliHealth.ok}`);
console.log(`CLI version: ${cliHealth.server?.version}`);
console.log(`CLI log path: ${cliHealth.log?.path}`);
if (!cliHealth.server?.version) throw new Error('CLI health missing version');
if (!cliHealth.log?.path) throw new Error('CLI health missing log path');

const child = spawn(process.execPath, ['cua-local.mjs'], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
});

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'health_check', arguments: { include_logs: true } } },
];

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

for (const request of requests) {
  child.stdin.write(`${JSON.stringify(request)}\n`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}
child.stdin.end();

const exitCode = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    resolve(124);
  }, 45000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve(code ?? 0);
  });
});

function parseMessages() {
  return stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function parseToolText(messages, id) {
  const message = messages.find((item) => item.id === id);
  const text = message?.result?.content?.[0]?.text;
  if (!text) throw new Error(`missing text result for id ${id}`);
  return JSON.parse(text);
}

if (exitCode === 124) throw new Error('MCP health smoke timed out');
if (stderr.trim()) console.error(stderr.trim().slice(0, 2000));

const messages = parseMessages();
const tools = messages.find((message) => message.id === 2)?.result?.tools || [];
const mcpHealth = parseToolText(messages, 3);

console.log(`MCP health tool listed: ${tools.some((tool) => tool.name === 'health_check')}`);
console.log(`MCP health ok: ${mcpHealth.ok}`);
console.log(`MCP health version: ${mcpHealth.server?.version}`);
console.log(`MCP health recent logs: ${mcpHealth.recentLogs?.length || 0}`);

if (!tools.some((tool) => tool.name === 'health_check')) throw new Error('tools/list missing health_check');
if (!mcpHealth.server?.version) throw new Error('MCP health missing version');
if (!mcpHealth.log?.path) throw new Error('MCP health missing log path');
if (!Array.isArray(mcpHealth.recentLogs)) throw new Error('MCP health missing recentLogs when include_logs=true');

console.log('PASS smoke-health CLI and MCP health check');
