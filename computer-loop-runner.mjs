#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const cliOptions = parseOptions(process.argv.slice(2));
const planName = positionalArgs[0] || 'safe-text-input-sample';
const traceEnabled = process.env.CUA_LOCAL_TRACE === '1' || Boolean(process.env.CUA_LOCAL_TRACE_DIR);
const traceRoot = resolve(cwd, process.env.CUA_LOCAL_TRACE_DIR || 'traces');
const sampleApp = cliOptions.app || process.env.CUA_LOCAL_SAMPLE_APP || 'TextEdit';
const sampleText = cliOptions.text || process.env.CUA_LOCAL_SAMPLE_TEXT || 'test';
const sampleTarget = cliOptions.target || cliOptions.label || process.env.CUA_LOCAL_SAMPLE_TARGET || '';

const riskPattern = /update all|update|install|buy|purchase|pay|delete|remove|trash|send|submit|publish|post|share|close|更新全部|全部更新|更新|安装|购买|支付|删除|移除|发送|提交|发布|卸载/i;

const plans = {
  'safe-move-sample': makeSafeMovePlan({ app: sampleApp, targetPattern: sampleTarget }),
  'safe-text-input-sample': makeSafeTextInputPlan({ app: sampleApp, text: sampleText, targetPattern: sampleTarget }),
};

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) continue;
    const [key, inlineValue] = item.slice(2).split('=');
    result[key] = inlineValue === undefined ? args[index + 1] : inlineValue;
    if (inlineValue === undefined) index += 1;
  }
  return result;
}

function bootstrapSampleApp(app) {
  spawnSync('/usr/bin/open', ['-a', app], { stdio: 'ignore' });
  if (/^TextEdit$/i.test(app)) {
    spawnSync('/usr/bin/osascript', [
      '-e', 'tell application "TextEdit" to activate',
      '-e', 'tell application "TextEdit" to make new document',
    ], { stdio: 'ignore' });
  }
}

function makeSafeMovePlan({ app, targetPattern }) {
  return {
    app,
    bootstrap() {
      bootstrapSampleApp(app);
    },
    describe: `Observe ${app}, choose a safe visible target, move the mouse to it, then observe again. Movement only; no click or submit action.`,
    chooseActions(state) {
      const target = chooseSafeTarget(state, targetPattern);
      return [{
        type: 'move_mouse',
        reason: 'Safe visible target chosen from AX tree; movement only, no click.',
        target: summarizeNode(target),
        request: { app: state.app, x: target.center.x, y: target.center.y },
      }];
    },
  };
}

function makeSafeTextInputPlan({ app, text, targetPattern }) {
  return {
    app,
    expectedText: text,
    bootstrap() {
      bootstrapSampleApp(app);
    },
    describe: `Observe ${app}, choose a safe text input, focus it, type sample text, then observe again. No submit action.`,
    chooseActions(state) {
      const target = chooseTextInput(state, targetPattern);
      const summarized = summarizeNode(target);
      const currentValueLength = String(target.value || '').length;
      const clearKeyCount = Math.min(Math.max(currentValueLength, 1), 64);
      const moveToEndActions = Array.from({ length: clearKeyCount }, (_, index) => ({
        type: 'press_key',
        reason: `Move insertion point right before clearing (${index + 1}/${clearKeyCount}).`,
        target: summarized,
        request: { app: state.app, key: 'right' },
      }));
      const clearActions = Array.from({ length: clearKeyCount }, (_, index) => ({
        type: 'press_key',
        reason: `Clear existing text with Backspace (${index + 1}/${clearKeyCount}) so the sample is repeatable.`,
        target: summarized,
        request: { app: state.app, key: 'backspace' },
      }));
      return [
        {
          type: 'move_mouse',
          reason: 'Move visibly to the safe text input before clicking.',
          target: summarized,
          request: { app: state.app, x: target.center.x, y: target.center.y },
        },
        {
          type: 'click',
          reason: 'Focus the safe text input.',
          target: summarized,
          request: { app: state.app, x: target.center.x, y: target.center.y },
        },
        {
          type: 'click',
          reason: 'Confirm focus after app activation.',
          target: summarized,
          request: { app: state.app, x: target.center.x, y: target.center.y },
        },
        ...moveToEndActions,
        ...clearActions,
        {
          type: 'type_text',
          reason: 'Type harmless sample text into the focused text input.',
          target: summarized,
          request: { app: state.app, text },
        },
      ];
    },
  };
}

const plan = plans[planName];
if (!plan) {
  console.error(`Unknown plan: ${planName}`);
  console.error(`Available plans: ${Object.keys(plans).join(', ')}`);
  process.exit(2);
}

function labelFor(node) {
  return [node.name, node.description, node.value].filter(Boolean).join(' ');
}

function patternMatches(node, patternText) {
  if (!patternText) return true;
  return new RegExp(patternText, 'i').test(labelFor(node));
}

function movableCandidates(state) {
  const tree = state.accessibility?.tree || [];
  return tree.filter((node) => {
    const label = labelFor(node);
    return node.center && ['AXTextField', 'AXTextArea', 'AXButton', 'AXGroup'].includes(node.role) && !riskPattern.test(label);
  });
}

function textInputCandidates(state) {
  return movableCandidates(state).filter((node) => ['AXTextField', 'AXTextArea'].includes(node.role));
}

function chooseTextInput(state, targetPattern) {
  const candidates = textInputCandidates(state);
  const target = candidates.find((node) => patternMatches(node, targetPattern)) || candidates[0];
  if (!target) throw new Error(`No safe text input found. app=${state.app} treeCount=${state.accessibility?.tree?.length || 0}`);
  return target;
}

function chooseSafeTarget(state, targetPattern) {
  const candidates = movableCandidates(state);
  const matching = candidates.filter((node) => patternMatches(node, targetPattern));
  const target = matching.find((node) => !['AXTextField', 'AXTextArea'].includes(node.role)) || matching[0] || candidates.find((node) => !['AXTextField', 'AXTextArea'].includes(node.role)) || candidates[0];
  if (!target) throw new Error(`No safe movable element found. app=${state.app} treeCount=${state.accessibility?.tree?.length || 0}`);
  return target;
}

function summarizeNode(node) {
  return {
    element_index: node.element_index,
    role: node.role,
    label: labelFor(node) || '(empty)',
    center: node.center || null,
  };
}

function textInputValues(state) {
  return (state.accessibility?.tree || [])
    .filter((node) => ['AXTextField', 'AXTextArea'].includes(node.role))
    .map((node) => ({ element_index: node.element_index, role: node.role, label: labelFor(node) || '(empty)', value: String(node.value || '') }));
}

function expectedTextInputValue(state, text) {
  return textInputValues(state).some((field) => field.value === text);
}

function validatePlanResult(currentPlan, after) {
  if (after.frontmostApp !== currentPlan.app) {
    throw new Error(`Sample app lost focus. expected=${currentPlan.app} observed=${after.frontmostApp || '(none)'}`);
  }
  if (currentPlan.expectedText && !expectedTextInputValue(after, currentPlan.expectedText)) {
    throw new Error(`Text input sample verification failed. observed=${JSON.stringify(textInputValues(after))}`);
  }
}

function summarizeState(state) {
  return {
    app: state.app,
    frontmostApp: state.frontmostApp,
    chrome: state.chrome ? { title: state.chrome.title, url: state.chrome.url, ok: state.chrome.ok } : null,
    accessibility: {
      source: state.accessibility?.source,
      treeCount: state.accessibility?.tree?.length || 0,
      axSummary: state.accessibility?.axSummary || null,
      textInputs: textInputValues(state).slice(0, 8),
    },
    screenshot: state.screenshot ? {
      mimeType: state.screenshot.mimeType,
      base64Length: state.screenshot.base64Length,
      dimensions: state.screenshot.dimensions,
    } : null,
  };
}

function parseJsonMessages(stdout) {
  const completeOutput = stdout.endsWith('\n') ? stdout : stdout.slice(0, stdout.lastIndexOf('\n') + 1);
  if (!completeOutput.trim()) return [];
  return completeOutput.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function safeFileSegment(value) {
  return String(value || 'trace').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'trace';
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createTraceContext(name) {
  const id = `${compactTimestamp()}-${safeFileSegment(name)}`;
  const dir = join(traceRoot, id);
  mkdirSync(dir, { recursive: true });
  return { id, dir, jsonPath: join(dir, 'trace.json') };
}

function toolImages(message) {
  return (message.result?.content || [])
    .filter((item) => item.type === 'image' && item.data)
    .map((item) => ({ mimeType: item.mimeType || 'image/png', data: item.data }));
}

function writeObservationImages(traceContext, phase, state) {
  if (!traceContext) return [];
  return (state._images || []).map((image, index) => {
    const ext = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `${safeFileSegment(phase)}${index ? `-${index + 1}` : ''}.${ext}`;
    const path = join(traceContext.dir, filename);
    const buffer = Buffer.from(image.data, 'base64');
    writeFileSync(path, buffer);
    return {
      path,
      mimeType: image.mimeType,
      byteLength: buffer.length,
      dimensions: state.screenshot?.dimensions || null,
    };
  });
}

function writeTraceFile(traceContext, trace) {
  if (!traceContext) return;
  writeFileSync(traceContext.jsonPath, `${JSON.stringify(trace, null, 2)}\n`);
}

class McpSession {
  constructor() {
    this.child = spawn(process.execPath, ['cua-local.mjs'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stdout = '';
    this.stderr = '';
    this.nextId = 1;
    this.child.stdout.on('data', (chunk) => { this.stdout += chunk; });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return id;
  }

  async waitFor(id, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = parseJsonMessages(this.stdout).find((item) => item.id === id);
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`timeout waiting for message id ${id}. stderr=${this.stderr.slice(0, 2000)} stdout=${this.stdout.slice(0, 2000)}`);
  }

  async callTool(name, args = {}) {
    const id = this.send('tools/call', { name, arguments: args });
    const message = await this.waitFor(id);
    const text = message.result?.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error(`tool ${name} returned no text: ${JSON.stringify(message).slice(0, 2000)}`);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }
    const images = toolImages(message);
    if (images.length) Object.defineProperty(parsed, '_images', { value: images, enumerable: false });
    if (message.result?.isError) {
      const error = new Error(`tool ${name} failed: ${text}`);
      error.result = parsed;
      throw error;
    }
    return parsed;
  }

  async initialize() {
    const initId = this.send('initialize', {});
    const toolsId = this.send('tools/list', {});
    const init = await this.waitFor(initId);
    const tools = await this.waitFor(toolsId);
    return { init: init.result, tools: tools.result?.tools || [] };
  }

  async close() {
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGTERM');
        resolve();
      }, 5000);
      this.child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function runPlan() {
  console.log(`Computer loop plan: ${planName}`);
  console.log(plan.describe);
  plan.bootstrap?.();
  await new Promise((resolve) => setTimeout(resolve, 3500));

  const session = new McpSession();
  const traceContext = traceEnabled ? createTraceContext(planName) : null;
  try {
    const handshake = await session.initialize();
    const trace = {
      trace: {
        schemaVersion: 1,
        id: traceContext?.id || `${compactTimestamp()}-${safeFileSegment(planName)}`,
        createdAt: new Date().toISOString(),
        jsonPath: traceContext?.jsonPath || null,
        directory: traceContext?.dir || null,
      },
      plan: planName,
      app: plan.app,
      server: handshake.init?.serverInfo || null,
      tools: handshake.tools.map((tool) => tool.name),
      rounds: [],
    };

    const before = await session.callTool('get_app_state', { app: plan.app, include_screenshot: traceEnabled });
    const actions = plan.chooseActions(before);
    trace.rounds.push({
      phase: 'observe_before',
      at: new Date().toISOString(),
      state: summarizeState(before),
      screenshots: writeObservationImages(traceContext, 'observe-before', before),
      chosenActions: actions.map((action) => ({ type: action.type, reason: action.reason, target: action.target })),
    });

    for (const [index, action] of actions.entries()) {
      const actionResult = await session.callTool(action.type, action.request);
      trace.rounds.push({
        phase: 'act',
        index: index + 1,
        at: new Date().toISOString(),
        action: { type: action.type, request: action.request, target: action.target, reason: action.reason },
        result: actionResult,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
    const after = await session.callTool('get_app_state', { app: plan.app, include_screenshot: traceEnabled });
    validatePlanResult(plan, after);
    trace.rounds.push({
      phase: 'observe_after',
      at: new Date().toISOString(),
      state: summarizeState(after),
      screenshots: writeObservationImages(traceContext, 'observe-after', after),
    });

    writeTraceFile(traceContext, trace);
    printTrace(trace);
  } finally {
    await session.close();
  }
}

function printTrace(trace) {
  console.log(`Server: ${trace.server?.name || 'unknown'} ${trace.server?.version || ''}`.trim());
  console.log(`Tools available: ${trace.tools.length}`);
  if (trace.trace?.jsonPath) console.log(`Trace written: ${trace.trace.jsonPath}`);
  else console.log('Trace disabled: set CUA_LOCAL_TRACE=1 or CUA_LOCAL_TRACE_DIR to write trace artifacts.');
  for (const round of trace.rounds) {
    if (round.phase === 'observe_before' || round.phase === 'observe_after') {
      console.log(`\n[${round.phase}]`);
      console.log(`frontmost=${round.state.frontmostApp}`);
      console.log(`treeCount=${round.state.accessibility.treeCount}`);
      console.log(`screenshot=${JSON.stringify(round.state.screenshot?.dimensions || null)} base64Length=${round.state.screenshot?.base64Length || 0}`);
      for (const shot of round.screenshots || []) console.log(`screenshotFile=${shot.path} byteLength=${shot.byteLength}`);
      for (const field of round.state.accessibility.textInputs || []) {
        console.log(`textInput=${field.element_index} role=${field.role} label=${field.label} value=${JSON.stringify(field.value)}`);
      }
      if (round.chosenActions) {
        for (const [index, action] of round.chosenActions.entries()) {
          console.log(`chosen_${index + 1}=${action.type} ${action.target.element_index} ${action.target.role}`);
          console.log(`label_${index + 1}=${action.target.label}`);
          console.log(`center_${index + 1}=${JSON.stringify(action.target.center)}`);
        }
      }
    } else if (round.phase === 'act') {
      console.log(`\n[act ${round.index}]`);
      console.log(`type=${round.action.type}`);
      console.log(`request=${JSON.stringify(round.action.request)}`);
      console.log(`reason=${round.action.reason}`);
      console.log(`result.ok=${round.result.ok}`);
      console.log(`result.point=${JSON.stringify(round.result.point || null)}`);
      console.log(`result.source=${round.result.source || ''}`);
      if (round.result.feedback) console.log(`result.feedback=${JSON.stringify(round.result.feedback)}`);
    }
  }
  console.log('\nPASS computer-loop-runner observe-act-observe');
}

runPlan().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
