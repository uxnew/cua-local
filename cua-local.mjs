#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_VERSION = '0.3.19-local';
const LOG_PATH = process.env.CUA_LOCAL_LOG_PATH || join(homedir(), '.cua-local', 'cua-local.log');

const tools = [
  {
    name: 'list_apps',
    description: 'List running GUI apps on this Mac. Local adapter; no Codex login required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_app_state',
    description: 'Get the app state: front window info, Chrome title/url when available, lightweight accessibility tree, and optional screenshot.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string' }, include_screenshot: { type: 'boolean' } },
      required: ['app'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_screen_state',
    description: 'Return display, screenshot, mouse, Retina scale, and coordinate-space diagnostics for calibration.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'health_check',
    description: 'Return server version, dependency, permission, log, and optional screen diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        include_screen: { type: 'boolean' },
        include_logs: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'open_url',
    description: 'Open an http(s) URL in Google Chrome. Local helper for browser smoke tests.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string' }, url: { type: 'string' } },
      required: ['app', 'url'],
      additionalProperties: false,
    },
  },
  {
    name: 'type_text',
    description: 'Type literal text into the active app using macOS System Events.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string' }, text: { type: 'string' } },
      required: ['app', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'press_key',
    description: 'Press a key or key-combination. Examples: Return, Tab, cmd+l, command+r, shift+cmd+r.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string' }, key: { type: 'string' } },
      required: ['app', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'click',
    description: 'Click screen coordinates or an accessibility element center using CGEvent. Use element_index from get_app_state when possible.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        element_index: { type: 'string' },
        coordinate_space: { type: 'string' },
        display_index: { type: 'integer' },
        click_count: { type: 'integer' },
        confirm_risk_action: { type: 'boolean' },
      },
      required: ['app'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_mouse',
    description: 'Move the visible mouse pointer to screen coordinates or an accessibility element center without clicking.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        element_index: { type: 'string' },
        coordinate_space: { type: 'string' },
        display_index: { type: 'integer' },
      },
      required: ['app'],
      additionalProperties: false,
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the active app by pages in a direction.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        direction: { type: 'string' },
        pages: { type: 'number' },
        element_index: { type: 'string' },
      },
      required: ['app', 'direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'drag',
    description: 'Drag from one screen coordinate to another using CGEvent.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        from_x: { type: 'number' },
        from_y: { type: 'number' },
        to_x: { type: 'number' },
        to_y: { type: 'number' },
      },
      required: ['app', 'from_x', 'from_y', 'to_x', 'to_y'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_value',
    description: 'Set value for a focused or known field. For Chrome, element_index="address_bar" sets the address bar.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        element_index: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['app', 'element_index', 'value'],
      additionalProperties: false,
    },
  },
];

function resultText(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError,
  };
}

function safeString(value, maxLength = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function logEvent(event, detail = {}) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), event, ...detail })}\n`);
  } catch {
    // Never break MCP protocol because logging failed.
  }
}

function recentLogLines(limit = 20) {
  try {
    if (!existsSync(LOG_PATH)) return [];
    return readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch (error) {
    return [{ error: String(error.message || error) }];
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    ...options,
  }).trim();
}

function commandStatus(command, args = []) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 });
  return {
    ok: result.status === 0,
    status: result.status,
    output: safeString(`${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0] || ''),
  };
}

function osa(lines) {
  const script = Array.isArray(lines) ? lines.join('\n') : lines;
  return run('/usr/bin/osascript', ['-e', script]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApp(app) {
  if (!app) return 'Google Chrome';
  if (/chrome/i.test(app)) return 'Google Chrome';
  return app;
}

function activateApp(app) {
  try {
    osa(`tell application ${JSON.stringify(normalizeApp(app))} to activate`);
  } catch {
    // Keep going: some apps cannot be activated by display name.
  }
}

function listApps() {
  try {
    const raw = osa('tell application "System Events" to get name of processes whose background only is false');
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  } catch (error) {
    throw new Error(`Accessibility/System Events permission missing or blocked: ${error.message || error}`);
  }
}

function getFrontmostApp() {
  try {
    return osa('tell application "System Events" to get name of first application process whose frontmost is true');
  } catch {
    return '';
  }
}

function chromeState() {
  try {
    const title = osa('tell application "Google Chrome" to get title of active tab of front window');
    const url = osa('tell application "Google Chrome" to get URL of active tab of front window');
    return { title, url };
  } catch (error) {
    return { title: '', url: '', error: String(error.message || error) };
  }
}

function ensureChromeWindow() {
  osa('tell application "Google Chrome" to if (count of windows) = 0 then make new window');
}

function normalizeAddressBarValue(value) {
  const trimmed = String(value || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function chromeUrlMatchesTarget(observedUrl, targetValue) {
  if (!observedUrl || !targetValue) return false;
  try {
    const observed = new URL(observedUrl);
    const target = new URL(targetValue);
    return observed.hostname === target.hostname || observed.href.startsWith(target.href);
  } catch {
    return String(observedUrl).includes(String(targetValue));
  }
}

async function waitForChromeUrl(targetValue, timeoutMs = 6500) {
  const deadline = Date.now() + timeoutMs;
  let last = chromeState();
  while (Date.now() < deadline) {
    last = chromeState();
    if (chromeUrlMatchesTarget(last.url, targetValue)) return { ok: true, chrome: last };
    await sleep(300);
  }
  return { ok: false, chrome: last };
}

async function setChromeAddressBar(value) {
  const targetValue = normalizeAddressBarValue(value);
  activateApp('Google Chrome');
  ensureChromeWindow();

  if (/^https?:\/\//i.test(targetValue)) {
    let directError = '';
    try {
      osa(`tell application "Google Chrome" to set URL of active tab of front window to ${JSON.stringify(targetValue)}`);
      const direct = await waitForChromeUrl(targetValue);
      if (direct.ok) {
        return {
          ok: true,
          method: 'chrome_apple_event_set_url',
          element_index: 'address_bar',
          value,
          targetUrl: targetValue,
          chrome: direct.chrome,
        };
      }
    } catch (error) {
      directError = String(error.message || error);
    }

    try {
      osa(pressKeyScript('cmd+l'));
      await sleep(200);
      osa(`tell application "System Events" to keystroke ${JSON.stringify(targetValue)}`);
      osa(pressKeyScript('Return'));
      const fallback = await waitForChromeUrl(targetValue);
      return {
        ok: fallback.ok,
        method: 'system_events_fallback',
        element_index: 'address_bar',
        value,
        targetUrl: targetValue,
        chrome: fallback.chrome,
        error: fallback.ok ? undefined : `Chrome URL did not reach target. directError=${directError || 'none'}`,
      };
    } catch (error) {
      return {
        ok: false,
        method: 'system_events_fallback',
        element_index: 'address_bar',
        value,
        targetUrl: targetValue,
        chrome: chromeState(),
        error: String(error.message || error),
      };
    }
  }

  osa(pressKeyScript('cmd+l'));
  await sleep(200);
  osa(`tell application "System Events" to keystroke ${JSON.stringify(targetValue)}`);
  return {
    ok: true,
    method: 'system_events_text_value',
    element_index: 'address_bar',
    value,
    chrome: chromeState(),
  };
}

function appWindowSummary(app) {
  const target = normalizeApp(app);
  try {
    const raw = osa([
      'tell application "System Events"',
      `tell process ${JSON.stringify(target)}`,
      'set windowNames to name of windows',
      'set roleNames to role of windows',
      'return (windowNames as text) & "\n" & (roleNames as text)',
      'end tell',
      'end tell',
    ]);
    const [namesLine = '', rolesLine = ''] = raw.split('\n');
    return {
      windows: namesLine ? namesLine.split(',').map((item) => item.trim()).filter(Boolean) : [],
      roles: rolesLine ? rolesLine.split(',').map((item) => item.trim()).filter(Boolean) : [],
    };
  } catch (error) {
    return { windows: [], roles: [], error: String(error.message || error) };
  }
}

function parsePoint(text) {
  const parts = String(text || '').split(',').map((item) => Number(item));
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item))) return null;
  return { x: parts[0], y: parts[1] };
}

function parseSize(text) {
  const parts = String(text || '').split(',').map((item) => Number(item));
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item))) return null;
  return { width: parts[0], height: parts[1] };
}

function axElementIndex(rawIndex, role, description) {
  if (/^AXTextField$/i.test(role) && /address and search bar/i.test(description || '')) return 'address_bar';
  return `ax_${rawIndex}`;
}

function axRoleIsActionable(role) {
  return ['AXButton', 'AXPopUpButton', 'AXCheckBox', 'AXRadioButton', 'AXTextField', 'AXLink', 'AXMenuItem'].includes(role);
}

function parseAxElementLine(line) {
  const [rawIndex, role = '', name = '', description = '', value = '', enabled = '', position = '', size = ''] = line.split('\t');
  if (!rawIndex || !role) return null;
  const cleanName = name === 'missing value' ? '' : name;
  const cleanValue = value === 'missing value' ? '' : value;
  const cleanDescription = description === 'missing value' ? '' : description;
  const hasText = Boolean(cleanName || cleanDescription || cleanValue);
  const actionable = axRoleIsActionable(role);
  if (!hasText && !actionable && role === 'AXGroup') return null;

  const parsedPosition = parsePoint(position);
  const parsedSize = parseSize(size);
  const node = {
    element_index: axElementIndex(rawIndex, role, cleanDescription),
    role,
  };
  if (cleanName) node.name = cleanName;
  if (cleanDescription) node.description = cleanDescription;
  if (cleanValue) node.value = cleanValue;
  if (enabled === 'true' || enabled === 'false') node.enabled = enabled === 'true';
  if (parsedPosition) node.position = parsedPosition;
  if (parsedSize) node.size = parsedSize;
  if (parsedPosition && parsedSize) {
    node.center = {
      x: parsedPosition.x + parsedSize.width / 2,
      y: parsedPosition.y + parsedSize.height / 2,
    };
  }
  return node;
}

function accessibilityElements(app, limit = 160) {
  const target = normalizeApp(app);
  try {
    const raw = osa([
      'on cleanText(v)',
      'try',
      'set t to v as text',
      'on error',
      'return ""',
      'end try',
      'set AppleScript\'s text item delimiters to {tab, return, linefeed}',
      'set parts to text items of t',
      'set AppleScript\'s text item delimiters to " "',
      'set t to parts as text',
      'set AppleScript\'s text item delimiters to ""',
      'return t',
      'end cleanText',
      'tell application "System Events"',
      `tell process ${JSON.stringify(target)}`,
      'if (count of windows) = 0 then return ""',
      'set elems to entire contents of window 1',
      'set out to ""',
      `set maxItems to ${Number(limit)}`,
      'repeat with i from 1 to (count of elems)',
      'if i > maxItems then exit repeat',
      'set e to item i of elems',
      'set roleText to ""',
      'set nameText to ""',
      'set descriptionText to ""',
      'set valueText to ""',
      'set enabledText to ""',
      'set positionText to ""',
      'set sizeText to ""',
      'try',
      'set roleText to my cleanText(role of e)',
      'end try',
      'try',
      'set nameText to my cleanText(name of e)',
      'end try',
      'try',
      'set descriptionText to my cleanText(description of e)',
      'end try',
      'try',
      'set valueText to my cleanText(value of e)',
      'end try',
      'try',
      'set enabledText to my cleanText(enabled of e)',
      'end try',
      'try',
      'set p to position of e',
      'set positionText to ((item 1 of p) as text) & "," & ((item 2 of p) as text)',
      'end try',
      'try',
      'set s to size of e',
      'set sizeText to ((item 1 of s) as text) & "," & ((item 2 of s) as text)',
      'end try',
      'if roleText is not "" then set out to out & i & tab & roleText & tab & nameText & tab & descriptionText & tab & valueText & tab & enabledText & tab & positionText & tab & sizeText & linefeed',
      'end repeat',
      'return out',
      'end tell',
      'end tell',
    ]);
    const nodes = raw.split('\n').map((line) => parseAxElementLine(line)).filter(Boolean);
    return { nodes, rawLineCount: raw ? raw.split('\n').filter(Boolean).length : 0 };
  } catch (error) {
    return { nodes: [], rawLineCount: 0, error: String(error.message || error) };
  }
}

function mergeAccessibilityNodes(nodes) {
  const byIndex = new Map();
  for (const node of nodes) {
    if (!node?.element_index) continue;
    if (!byIndex.has(node.element_index)) {
      byIndex.set(node.element_index, node);
      continue;
    }
    const current = byIndex.get(node.element_index);
    byIndex.set(node.element_index, { ...node, ...current, position: node.position || current.position, size: node.size || current.size, center: node.center || current.center });
  }
  return [...byIndex.values()];
}

function elementTextForRisk(element = {}) {
  const safeElement = element || {};
  return [safeElement.name, safeElement.description, safeElement.value].filter(Boolean).join(' ').trim();
}

const highRiskPatterns = [
  { pattern: /\bupdate\s+all\b/i, reason: 'bulk software update' },
  { pattern: /\b(update|install)\b/i, reason: 'software update/install action' },
  { pattern: /\b(buy|purchase|subscribe|checkout|pay)\b/i, reason: 'purchase or payment action' },
  { pattern: /\b(delete|remove|trash|discard|erase|destroy)\b/i, reason: 'destructive action' },
  { pattern: /\b(send|submit|publish|post|share)\b/i, reason: 'external submission or publication action' },
  { pattern: /\bclose\b/i, reason: 'close/dismiss action' },
  { pattern: /删除|移除|购买|付款|支付|发送|提交|发布|更新全部|全部更新|安装|卸载/, reason: 'high-risk localized action' },
];

export function assessHighRiskElement(element) {
  const safeElement = element || {};
  const label = elementTextForRisk(safeElement);
  if (!label) return { risky: false, label: '' };
  const match = highRiskPatterns.find((item) => item.pattern.test(label));
  if (!match) return { risky: false, label };
  return {
    risky: true,
    label,
    reason: match.reason,
    element_index: safeElement.element_index,
    role: safeElement.role,
  };
}

function pointInRect(point, rect) {
  if (!point || !rect) return false;
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function smallestAreaElementContainingPoint(tree, point) {
  let best = null;
  let bestArea = Infinity;
  for (const node of tree) {
    if (!node.position || !node.size) continue;
    if (!pointInRect(point, { ...node.position, ...node.size })) continue;
    const area = node.size.width * node.size.height;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}

function screenScale(screen) {
  const scaleX = screen?.frame?.width ? screen.pixelSize.width / screen.frame.width : screen?.backingScaleFactor || 1;
  const scaleY = screen?.frame?.height ? screen.pixelSize.height / screen.frame.height : screen?.backingScaleFactor || 1;
  return { x: scaleX || 1, y: scaleY || 1 };
}

function displayForGlobalPoint(metrics, point) {
  const screens = metrics?.screens || [];
  return screens.find((screen) => pointInRect(point, screen.frame)) || screens.find((screen) => screen.isMain) || screens[0] || null;
}

function displayForArgs(metrics, args = {}) {
  const screens = metrics?.screens || [];
  const requestedIndex = Number(args.display_index);
  if (Number.isInteger(requestedIndex)) return screens.find((screen) => screen.index === requestedIndex) || null;
  return screens.find((screen) => screen.isMain) || screens[0] || null;
}

function pointToDisplayPixels(point, screen) {
  if (!point || !screen?.frame) return null;
  const scale = screenScale(screen);
  return {
    x: (point.x - screen.frame.x) * scale.x,
    y: (point.y - screen.frame.y) * scale.y,
  };
}

export function resolveCoordinatePoint(inputPoint, args = {}, calibrationState = null) {
  const state = calibrationState || screenCalibrationState();
  const coordinateSpace = String(args.coordinate_space || 'global_display_points').trim() || 'global_display_points';
  const metrics = state.metrics || {};
  const warnings = [];
  let display = null;
  let point = { x: inputPoint.x, y: inputPoint.y };

  if (coordinateSpace === 'global_display_points' || coordinateSpace === 'screen_points' || coordinateSpace === 'ax_points') {
    display = displayForGlobalPoint(metrics, point);
  } else if (coordinateSpace === 'screenshot_pixels' || coordinateSpace === 'display_pixels') {
    display = displayForArgs(metrics, args);
    if (!display) throw new Error('Cannot resolve screenshot_pixels without a display');
    if ((metrics.screens?.length || 0) > 1 && !Number.isInteger(Number(args.display_index))) {
      warnings.push('Multiple displays detected; screenshot_pixels defaulted to the main display. Pass display_index to disambiguate.');
    }
    const scale = screenScale(display);
    point = {
      x: display.frame.x + inputPoint.x / scale.x,
      y: display.frame.y + inputPoint.y / scale.y,
    };
  } else {
    throw new Error(`Unsupported coordinate_space: ${coordinateSpace}`);
  }

  if (!display) display = displayForArgs(metrics, args);
  const displayPixelPoint = pointToDisplayPixels(point, display);
  const scale = screenScale(display);
  return {
    point,
    transform: {
      inputPoint,
      inputCoordinateSpace: coordinateSpace,
      outputCoordinateSpace: 'global_display_points',
      display: display ? {
        index: display.index,
        displayID: display.displayID,
        isMain: display.isMain,
        frame: display.frame,
        pixelSize: display.pixelSize,
        backingScaleFactor: display.backingScaleFactor,
      } : null,
      scale,
      displayPixelPoint,
      screenshotDimensions: state.screenshot?.dimensions || null,
      screenshotMatchesMainScreen: state.calibration?.screenshotMatchesMainScreen || false,
      warnings,
    },
  };
}

function pointFromArgsOrElement(app, args = {}) {
  const directX = Number(args.x);
  const directY = Number(args.y);
  const calibration = screenCalibrationState();
  if (Number.isFinite(directX) && Number.isFinite(directY)) {
    const resolved = resolveCoordinatePoint({ x: directX, y: directY }, args, calibration);
    const accessibility = lightweightAccessibilityTree(app);
    const element = smallestAreaElementContainingPoint(accessibility.tree, resolved.point);
    return { point: resolved.point, source: 'coordinates', element, accessibilitySummary: accessibility.axSummary, transform: resolved.transform };
  }

  const elementIndex = String(args.element_index || '').trim();
  if (!elementIndex) throw new Error('Provide x/y coordinates or element_index');

  const accessibility = lightweightAccessibilityTree(app);
  const element = accessibility.tree.find((node) => node.element_index === elementIndex);
  if (!element) throw new Error(`element_index not found: ${elementIndex}`);
  if (!element.center || !Number.isFinite(element.center.x) || !Number.isFinite(element.center.y)) {
    throw new Error(`element_index has no center coordinates: ${elementIndex}`);
  }
  const resolved = resolveCoordinatePoint(element.center, { coordinate_space: 'global_display_points' }, calibration);
  return { point: resolved.point, source: 'element_index', element, accessibilitySummary: accessibility.axSummary, transform: resolved.transform };
}

export function enforceClickRiskGuard(target, args = {}) {
  const risk = assessHighRiskElement(target.element);
  if (!risk.risky) return { blocked: false, risk };
  if (args.confirm_risk_action === true) return { blocked: false, risk, confirmed: true };
  return {
    blocked: true,
    risk,
    message: 'High-risk click blocked. Re-run with confirm_risk_action=true only if the user explicitly approves this action.',
  };
}

function lightweightAccessibilityTree(app) {
  const target = normalizeApp(app);
  const summary = appWindowSummary(target);
  const tree = [];
  summary.windows.forEach((name, index) => {
    tree.push({
      element_index: `window_${index + 1}`,
      role: summary.roles[index] || 'AXWindow',
      name,
    });
  });

  const ax = accessibilityElements(target);
  tree.push(...ax.nodes);

  if (/chrome/i.test(target)) {
    const chrome = chromeState();
    tree.unshift({
      element_index: 'address_bar',
      role: 'AXTextField',
      name: 'Chrome address bar',
      value: chrome.url || '',
    });
    if (chrome.title) {
      tree.unshift({
        element_index: 'active_tab',
        role: 'AXTab',
        name: chrome.title,
        value: chrome.url || '',
      });
    }
  }
  return {
    tree: mergeAccessibilityNodes(tree),
    source: 'local_apple_events_ax',
    windowSummary: summary,
    axSummary: { rawLineCount: ax.rawLineCount, returnedCount: ax.nodes.length, error: ax.error },
  };
}

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function captureScreenshotBuffer() {
  const output = '/tmp/cua-local-state.png';
  spawnSync('/usr/sbin/screencapture', ['-x', output], { stdio: 'ignore' });
  if (!existsSync(output)) return null;
  return readFileSync(output);
}

function screenshotBase64() {
  const buffer = captureScreenshotBuffer();
  if (!buffer) return null;
  return buffer.toString('base64');
}

function screenshotMetadata() {
  const buffer = captureScreenshotBuffer();
  if (!buffer) return null;
  return { mimeType: 'image/png', byteLength: buffer.length, dimensions: pngDimensions(buffer) };
}

function modifierName(part) {
  const p = part.toLowerCase();
  if (['cmd', 'command', 'super', 'meta'].includes(p)) return 'command down';
  if (['ctrl', 'control'].includes(p)) return 'control down';
  if (['alt', 'option'].includes(p)) return 'option down';
  if (p === 'shift') return 'shift down';
  return null;
}

const keyCodeMap = new Map([
  ['return', 36],
  ['enter', 36],
  ['tab', 48],
  ['escape', 53],
  ['esc', 53],
  ['backspace', 51],
  ['delete', 51],
  ['space', 49],
  ['left', 123],
  ['right', 124],
  ['down', 125],
  ['up', 126],
  ['home', 115],
  ['end', 119],
  ['pageup', 116],
  ['pagedown', 121],
]);

function pressKeyScript(key) {
  const parts = String(key || 'Return').split('+').map((part) => part.trim()).filter(Boolean);
  const keyPart = parts.pop() || 'Return';
  const modifiers = parts.map(modifierName).filter(Boolean);
  const usingClause = modifiers.length ? ` using {${modifiers.join(', ')}}` : '';
  const code = keyCodeMap.get(keyPart.toLowerCase());
  if (code !== undefined) return `tell application "System Events" to key code ${code}${usingClause}`;
  if (keyPart.length === 1) return `tell application "System Events" to keystroke ${JSON.stringify(keyPart)}${usingClause}`;
  return `tell application "System Events" to keystroke ${JSON.stringify(keyPart)}${usingClause}`;
}

function ensurePointerTool() {
  const binary = '/tmp/cua-local-pointer-v5';
  if (existsSync(binary)) return binary;
  const source = '/tmp/cua-local-pointer-v5.swift';
  const repoSource = fileURLToPath(new URL('./helpers/pointer-helper.swift', import.meta.url));
  copyFileSync(repoSource, source);
  const result = spawnSync('/usr/bin/swiftc', [source, '-o', binary], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'failed to compile pointer helper');
  return binary;
}

function screenMetrics() {
  const result = spawnSync(ensurePointerTool(), ['metrics'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'screen metrics failed');
  return JSON.parse(result.stdout || '{}');
}

function screenCalibrationState() {
  const metrics = screenMetrics();
  const screenshot = screenshotMetadata();
  const mainScreen = metrics.screens?.find((screen) => screen.isMain) || metrics.screens?.[0] || null;
  const expectedMainScreenshotSize = mainScreen
    ? {
        width: Math.round(mainScreen.frame.width * mainScreen.backingScaleFactor),
        height: Math.round(mainScreen.frame.height * mainScreen.backingScaleFactor),
      }
    : null;
  return {
    metrics,
    screenshot,
    calibration: {
      coordinateSpace: 'global_display_points_for_AX_and_CGEvent; screenshot_pixels_for_screencapture',
      mainScreenScale: mainScreen?.backingScaleFactor || null,
      expectedMainScreenshotSize,
      screenshotMatchesMainScreen: Boolean(
        screenshot?.dimensions &&
        expectedMainScreenshotSize &&
        screenshot.dimensions.width === expectedMainScreenshotSize.width &&
        screenshot.dimensions.height === expectedMainScreenshotSize.height,
      ),
      displayCount: metrics.screens?.length || 0,
      activeDisplayCount: metrics.activeDisplays?.length || 0,
    },
  };
}

export function collectHealth(options = {}) {
  const includeScreen = options.include_screen === true;
  const includeLogs = options.include_logs === true;
  const health = {
    ok: true,
    server: { name: 'Local Computer Use', version: SERVER_VERSION, protocolVersion: PROTOCOL_VERSION },
    process: { pid: process.pid, node: process.version, platform: `${platform()} ${release()}`, cwd: process.cwd() },
    log: { path: LOG_PATH },
    dependencies: {
      osascript: commandStatus('/usr/bin/osascript', ['-e', 'return "ok"']),
      swiftc: commandStatus('/usr/bin/swiftc', ['--version']),
      screencapture: commandStatus('/usr/sbin/screencapture', ['-x', '/tmp/cua-local-health.png']),
    },
    permissions: {},
  };

  try {
    const frontmost = osa('tell application "System Events" to get name of first application process whose frontmost is true');
    health.permissions.systemEvents = { ok: true, frontmost };
  } catch (error) {
    health.permissions.systemEvents = { ok: false, error: safeString(String(error.stderr || error.message || error)) };
  }

  try {
    health.chrome = chromeState();
    health.chrome.ok = Boolean(health.chrome.url || !health.chrome.error);
  } catch (error) {
    health.chrome = { ok: false, error: safeString(String(error.message || error)) };
  }

  if (includeScreen) {
    try {
      health.screen = screenCalibrationState();
    } catch (error) {
      health.screen = { error: safeString(String(error.message || error)) };
    }
  }

  if (includeLogs) health.recentLogs = recentLogLines(20);

  const dependencyOk = Object.values(health.dependencies).every((item) => item.ok);
  const permissionsOk = Object.values(health.permissions).every((item) => item.ok !== false);
  health.ok = dependencyOk && permissionsOk;
  return health;
}

async function callTool(name, args = {}) {
  if (name === 'list_apps') return resultText({ apps: listApps(), frontmostApp: getFrontmostApp() });

  if (name === 'health_check') return resultText(collectHealth(args));

  if (name === 'get_screen_state') return resultText(screenCalibrationState());

  if (name === 'get_app_state') {
    const app = normalizeApp(args.app);
    activateApp(app);
    await sleep(500);
    const chrome = /chrome/i.test(app) ? chromeState() : null;
    const includeScreenshot = args.include_screenshot !== false;
    const image = includeScreenshot ? screenshotBase64() : null;
    const state = {
      app,
      frontmostApp: getFrontmostApp(),
      runningApps: listApps(),
      chrome,
      accessibility: lightweightAccessibilityTree(app),
      screenshot: image ? { mimeType: 'image/png', base64Length: image.length, dimensions: pngDimensions(Buffer.from(image, 'base64')) } : null,
    };
    const content = [{ type: 'text', text: JSON.stringify(state, null, 2) }];
    if (image) content.push({ type: 'image', mimeType: 'image/png', data: image });
    return { content, isError: false };
  }

  if (name === 'open_url') {
    const app = normalizeApp(args.app);
    const url = String(args.url || '');
    if (!/^https?:\/\//i.test(url)) return resultText('open_url only supports http(s) URLs', true);
    if (!/chrome/i.test(app)) return resultText('open_url currently supports Google Chrome only', true);
    activateApp(app);
    osa('tell application "Google Chrome" to if (count of windows) = 0 then make new window');
    osa(`tell application "Google Chrome" to set URL of active tab of front window to ${JSON.stringify(url)}`);
    await sleep(2500);
    return resultText({ ok: true, app, chrome: chromeState() });
  }

  if (name === 'type_text') {
    activateApp(args.app);
    osa(`tell application "System Events" to keystroke ${JSON.stringify(String(args.text || ''))}`);
    return resultText({ ok: true });
  }

  if (name === 'press_key') {
    activateApp(args.app);
    osa(pressKeyScript(args.key));
    return resultText({ ok: true, key: args.key });
  }

  if (name === 'set_value') {
    const app = normalizeApp(args.app);
    const value = String(args.value || '');
    if (/chrome/i.test(app) && String(args.element_index || '').toLowerCase() === 'address_bar') {
      const result = await setChromeAddressBar(value);
      return resultText({ app, ...result }, !result.ok);
    }
    activateApp(app);
    osa(`tell application "System Events" to keystroke ${JSON.stringify(value)}`);
    return resultText({ ok: true, app, element_index: args.element_index, value });
  }

  if (name === 'move_mouse') {
    const app = normalizeApp(args.app);
    activateApp(app);
    await sleep(250);
    const target = pointFromArgsOrElement(app, args);
    const result = spawnSync(ensurePointerTool(), ['move', String(target.point.x), String(target.point.y)], { encoding: 'utf8' });
    if (result.status !== 0) return resultText(result.stderr || result.stdout || 'move_mouse failed', true);
    return resultText({ ok: true, app, ...target });
  }

  if (name === 'click') {
    const app = normalizeApp(args.app);
    activateApp(app);
    await sleep(250);
    const target = pointFromArgsOrElement(app, args);
    const guard = enforceClickRiskGuard(target, args);
    if (guard.blocked) return resultText({ ok: false, app, ...target, guard }, true);
    const result = spawnSync(ensurePointerTool(), ['click', String(target.point.x), String(target.point.y), String(args.click_count || 1)], { encoding: 'utf8' });
    if (result.status !== 0) return resultText(result.stderr || result.stdout || 'click failed', true);
    return resultText({
      ok: true,
      app,
      click_count: args.click_count || 1,
      feedback: { visual: 'click_pulse_ring', duration_ms: 420, helper: 'pointer_v5' },
      ...target,
      guard,
    });
  }

  if (name === 'scroll') {
    activateApp(args.app);
    const direction = String(args.direction || 'down').toLowerCase();
    const pages = Number(args.pages || 1);
    const sign = direction === 'down' || direction === 'right' ? -1 : 1;
    const amount = Math.trunc(sign * pages * 700);
    const result = spawnSync(ensurePointerTool(), ['scroll', String(amount)], { encoding: 'utf8' });
    if (result.status !== 0) return resultText(result.stderr || result.stdout || 'scroll failed', true);
    return resultText({ ok: true, direction, pages, amount });
  }

  if (name === 'drag') {
    activateApp(args.app);
    const result = spawnSync(ensurePointerTool(), ['drag', String(args.from_x), String(args.from_y), String(args.to_x), String(args.to_y)], { encoding: 'utf8' });
    if (result.status !== 0) return resultText(result.stderr || result.stdout || 'drag failed', true);
    return resultText({ ok: true, from_x: args.from_x, from_y: args.from_y, to_x: args.to_x, to_y: args.to_y });
  }

  return resultText(`Unknown tool: ${name}`, true);
}

async function handleRequest(req) {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'Local Computer Use', version: SERVER_VERSION },
      },
    };
  }
  if (req.method === 'tools/list') return { jsonrpc: '2.0', id: req.id, result: { tools } };
  if (req.method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: await callTool(req.params?.name, req.params?.arguments || {}),
    };
  }
  if (req.id !== undefined) return { jsonrpc: '2.0', id: req.id, result: {} };
  return null;
}

let inputBuffer = Buffer.alloc(0);
let framingMode = 'auto';
let outputFraming = 'jsonl';
let processing = Promise.resolve();

function writeResponse(response) {
  const json = JSON.stringify(response);
  if (outputFraming === 'content-length') {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
    return;
  }
  process.stdout.write(`${json}\n`);
}

function queueRequest(req) {
  processing = processing.then(async () => {
    try {
      const response = await handleRequest(req);
      if (response) writeResponse(response);
    } catch (error) {
      logEvent('request_error', { method: req?.method, id: req?.id, error: safeString(String(error.stack || error.message || error)) });
      writeResponse({
        jsonrpc: '2.0',
        id: req?.id,
        result: resultText(String(error.message || error), true),
      });
    }
  });
}

function queueJsonText(text) {
  let req;
  try {
    req = JSON.parse(text);
  } catch {
    return;
  }
  queueRequest(req);
}

function processJsonlFrames() {
  let newlineIndex;
  while ((newlineIndex = inputBuffer.indexOf(0x0a)) >= 0) {
    const line = inputBuffer.slice(0, newlineIndex).toString('utf8').trim();
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (line) queueJsonText(line);
  }
}

function headerEndIndex(buffer) {
  const crlfIndex = buffer.indexOf('\r\n\r\n');
  if (crlfIndex >= 0) return { index: crlfIndex, length: 4 };
  const lfIndex = buffer.indexOf('\n\n');
  if (lfIndex >= 0) return { index: lfIndex, length: 2 };
  return null;
}

function processContentLengthFrames() {
  while (inputBuffer.length) {
    const headerEnd = headerEndIndex(inputBuffer);
    if (!headerEnd) return;

    const headers = inputBuffer.slice(0, headerEnd.index).toString('utf8');
    const match = headers.match(/(?:^|\r?\n)Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(headerEnd.index + headerEnd.length);
      continue;
    }

    const contentLength = Number(match[1]);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      inputBuffer = inputBuffer.slice(headerEnd.index + headerEnd.length);
      continue;
    }

    const bodyStart = headerEnd.index + headerEnd.length;
    const bodyEnd = bodyStart + contentLength;
    if (inputBuffer.length < bodyEnd) return;

    const body = inputBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    inputBuffer = inputBuffer.slice(bodyEnd);
    queueJsonText(body);
  }
}

function processIncoming() {
  if (framingMode === 'auto') {
    const preview = inputBuffer.toString('utf8', 0, Math.min(inputBuffer.length, 64)).trimStart();
    if (/^Content-Length:/i.test(preview)) {
      framingMode = 'content-length';
      outputFraming = 'content-length';
    } else if (inputBuffer.indexOf(0x0a) >= 0) {
      framingMode = 'jsonl';
      outputFraming = 'jsonl';
    } else {
      return;
    }
  }

  if (framingMode === 'content-length') processContentLengthFrames();
  else processJsonlFrames();
}

export function startServer() {
  logEvent('server_start', { version: SERVER_VERSION, protocolVersion: PROTOCOL_VERSION, pid: process.pid, cwd: process.cwd() });
  process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    processIncoming();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--health')) {
    console.log(JSON.stringify(collectHealth({ include_screen: process.argv.includes('--screen'), include_logs: process.argv.includes('--logs') }), null, 2));
  } else {
    startServer();
  }
}
