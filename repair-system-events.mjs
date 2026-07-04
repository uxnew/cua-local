#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

const systemEventsBinary = '/System/Library/CoreServices/System Events.app/Contents/MacOS/System Events';

function osa(script) {
  return execFileSync('/usr/bin/osascript', ['-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  }).trim();
}

function checkSystemEvents() {
  try {
    const frontmost = osa('tell application "System Events" to get name of first application process whose frontmost is true');
    return { ok: true, frontmost };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.message || error).trim() };
  }
}

function startSystemEventsBinary() {
  const child = spawnSync(systemEventsBinary, [], {
    detached: true,
    stdio: 'ignore',
    timeout: 1000,
  });
  if (child.error && child.error.code !== 'ETIMEDOUT') {
    return { ok: false, error: String(child.error.message || child.error) };
  }
  return { ok: true };
}

const before = checkSystemEvents();
if (before.ok) {
  console.log(`PASS System Events already healthy — frontmost=${before.frontmost}`);
  process.exit(0);
}

console.log(`WARN System Events unhealthy — ${before.error}`);
console.log('Attempting repair by launching the System Events binary directly...');

startSystemEventsBinary();
await new Promise((resolve) => setTimeout(resolve, 2000));

const after = checkSystemEvents();
if (after.ok) {
  console.log(`PASS System Events repaired — frontmost=${after.frontmost}`);
  process.exit(0);
}

console.error(`FAIL System Events still unhealthy — ${after.error}`);
console.error('Manual fallback: log out/in, or restart macOS, then re-run npm run doctor.');
process.exit(1);
