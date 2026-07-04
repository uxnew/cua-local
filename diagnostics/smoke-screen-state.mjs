#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const child = spawn(process.execPath, ['cua-local.mjs'], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
});

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_screen_state', arguments: {} } },
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

try {
  if (exitCode === 124) throw new Error('cua-local screen state smoke timed out');
  if (stderr.trim()) console.error(stderr.trim().slice(0, 2000));

  const messages = parseMessages();
  const tools = messages.find((message) => message.id === 2)?.result?.tools || [];
  const state = parseToolText(messages, 3);

  const main = state.metrics?.screens?.find((screen) => screen.isMain) || state.metrics?.screens?.[0];
  console.log(`tool get_screen_state: ${tools.some((tool) => tool.name === 'get_screen_state')}`);
  console.log(`displayCount: ${state.calibration?.displayCount}`);
  console.log(`activeDisplayCount: ${state.calibration?.activeDisplayCount}`);
  console.log(`mainScale: ${state.calibration?.mainScreenScale}`);
  console.log(`mainFrame: ${JSON.stringify(main?.frame || null)}`);
  console.log(`mainPixelSize: ${JSON.stringify(main?.pixelSize || null)}`);
  console.log(`mouse: ${JSON.stringify(state.metrics?.mouse || null)}`);
  console.log(`screenshot: ${JSON.stringify(state.screenshot?.dimensions || null)}`);
  console.log(`screenshotMatchesMainScreen: ${state.calibration?.screenshotMatchesMainScreen}`);

  if (!tools.some((tool) => tool.name === 'get_screen_state')) throw new Error('tools/list missing get_screen_state');
  if (!state.metrics?.screens?.length) throw new Error('missing NSScreen metrics');
  if (!state.metrics?.activeDisplays?.length) throw new Error('missing CGDisplay metrics');
  if (!Number.isFinite(state.metrics?.mouse?.x) || !Number.isFinite(state.metrics?.mouse?.y)) throw new Error('missing mouse coordinates');
  if (!state.screenshot?.dimensions?.width || !state.screenshot?.dimensions?.height) throw new Error('missing screenshot dimensions');
  if (!state.calibration?.coordinateSpace?.includes('global_display_points')) throw new Error('missing coordinate notes');

  console.log('PASS smoke-screen-state coordinate calibration diagnostics');
  process.exit(0);
} catch (error) {
  console.error(`FAIL smoke-screen-state: ${error.message || error}`);
  console.error(stdout.slice(0, 2400));
  process.exit(1);
}
