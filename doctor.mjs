#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, unlinkSync } from 'node:fs';
import { platform, release } from 'node:os';
import { resolve } from 'node:path';

const checks = [];
const systemEventsBinary = '/System/Library/CoreServices/System Events.app/Contents/MacOS/System Events';

function addCheck(name, ok, detail = '', recovery = '', required = true) {
  checks.push({ name, ok, detail, recovery, required });
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0] || '',
  };
}

function osa(script) {
  return execFileSync('/usr/bin/osascript', ['-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  }).trim();
}

function systemEventsProbe() {
  try {
    const frontmost = osa('tell application "System Events" to get name of first application process whose frontmost is true');
    return { ok: true, frontmost };
  } catch (error) {
    const message = String(error.stderr || error.message || error).trim();
    return { ok: false, error: message, appNotRunning: /isn.t running|isn’t running|-600/i.test(message) };
  }
}

function attemptSystemEventsRepair() {
  const result = spawnSync(systemEventsBinary, [], {
    detached: true,
    stdio: 'ignore',
    timeout: 1000,
  });
  if (result.error && result.error.code !== 'ETIMEDOUT') return { ok: false, error: String(result.error.message || result.error) };
  return { ok: true };
}

addCheck('macOS platform', platform() === 'darwin', `${platform()} ${release()}`);

const nodeMajor = Number(process.versions.node.split('.')[0]);
addCheck('Node.js >= 20', nodeMajor >= 20, process.version);

for (const item of [
  ['/usr/bin/osascript', ['-e', 'return "ok"']],
  ['/usr/bin/swiftc', ['--version']],
]) {
  const result = commandExists(item[0], item[1]);
  addCheck(item[0], result.ok, result.output);
}

try {
  accessSync('/usr/sbin/screencapture', constants.X_OK);
  const screenshotPath = '/tmp/cua-local-doctor-screenshot.png';
  const result = spawnSync('/usr/sbin/screencapture', ['-x', screenshotPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  });
  const ok = result.status === 0 && existsSync(screenshotPath);
  if (existsSync(screenshotPath)) unlinkSync(screenshotPath);
  addCheck(
    'screencapture / Screen Recording',
    ok,
    ok ? 'screenshot captured' : 'Grant Screen Recording permission to the MCP host app or Terminal',
    'System Settings > Privacy & Security > Screen Recording',
  );
} catch (error) {
  addCheck('screencapture / Screen Recording', false, String(error.message || error));
}

try {
  accessSync(resolve('cua-local.mjs'), constants.R_OK);
  addCheck('cua-local.mjs readable', true, resolve('cua-local.mjs'));
} catch (error) {
  addCheck('cua-local.mjs readable', false, String(error.message || error));
}

let systemEvents = systemEventsProbe();
if (!systemEvents.ok && systemEvents.appNotRunning) {
  const repair = attemptSystemEventsRepair();
  if (repair.ok) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    systemEvents = systemEventsProbe();
  }
}

if (systemEvents.ok) {
  addCheck('Accessibility permission / System Events', true, `frontmost=${systemEvents.frontmost}`);
} else {
  const recovery = systemEvents.appNotRunning
    ? 'Run npm run repair:system-events, then npm run doctor. If it still fails, log out/in or restart macOS.'
    : 'Grant Accessibility permission to the MCP host app or Terminal in System Settings > Privacy & Security > Accessibility';
  addCheck('Accessibility permission / System Events', false, systemEvents.error, recovery);
}

try {
  osa('tell application "Google Chrome" to if (count of windows) = 0 then make new window');
  const url = osa('tell application "Google Chrome" to get URL of active tab of front window');
  addCheck('Google Chrome Apple Events', true, url || 'active tab reachable', '', false);
} catch (error) {
  addCheck(
    'Google Chrome Apple Events',
    false,
    'Install/open Google Chrome and allow Automation permission when macOS prompts. The default validation path does not require Chrome.',
    'System Settings > Privacy & Security > Automation',
    false,
  );
}

const failed = checks.filter((check) => !check.ok && check.required !== false);
for (const check of checks) {
  const mark = check.ok ? 'PASS' : check.required === false ? 'WARN' : 'FAIL';
  console.log(`${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  if (!check.ok && check.recovery) console.log(`  recovery: ${check.recovery}`);
}

console.log('\nMCP config example for this checkout:');
console.log(JSON.stringify({
  mcpServers: {
    'computer-use-local': {
      command: process.execPath,
      args: [resolve('cua-local.mjs')],
      cwd: resolve('.'),
    },
  },
}, null, 2));

if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nAll checks passed.');
