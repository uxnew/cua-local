#!/usr/bin/env node
import { assessHighRiskElement, enforceClickRiskGuard } from '../cua-local.mjs';

const cases = [
  {
    name: 'blocks Update All',
    target: { element: { element_index: 'ax_test_1', role: 'AXButton', description: 'Update All' } },
    args: {},
    expectBlocked: true,
  },
  {
    name: 'blocks Delete localized',
    target: { element: { element_index: 'ax_test_2', role: 'AXButton', name: '删除' } },
    args: {},
    expectBlocked: true,
  },
  {
    name: 'blocks Send',
    target: { element: { element_index: 'ax_test_3', role: 'AXButton', description: 'Send' } },
    args: {},
    expectBlocked: true,
  },
  {
    name: 'allows risk with explicit confirm',
    target: { element: { element_index: 'ax_test_4', role: 'AXButton', description: 'Purchase' } },
    args: { confirm_risk_action: true },
    expectBlocked: false,
    expectConfirmed: true,
  },
  {
    name: 'allows safe Back button',
    target: { element: { element_index: 'ax_test_5', role: 'AXButton', description: 'Back' } },
    args: {},
    expectBlocked: false,
  },
  {
    name: 'allows coordinate click with no AX element',
    target: { element: null, point: { x: 110, y: 1242 }, source: 'coordinates' },
    args: {},
    expectBlocked: false,
  },
];

for (const item of cases) {
  const risk = assessHighRiskElement(item.target.element);
  const guard = enforceClickRiskGuard(item.target, item.args);
  console.log(`${item.name}: risky=${risk.risky} blocked=${guard.blocked} reason=${risk.reason || 'none'}`);
  if (guard.blocked !== item.expectBlocked) {
    throw new Error(`${item.name} expected blocked=${item.expectBlocked}, got ${guard.blocked}`);
  }
  if (item.expectConfirmed && guard.confirmed !== true) {
    throw new Error(`${item.name} expected confirmed=true`);
  }
}

console.log('PASS smoke-risk-guard high-risk click confirmation');
