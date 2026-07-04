#!/usr/bin/env node
import { resolveCoordinatePoint } from '../cua-local.mjs';

const fakeCalibration = {
  metrics: {
    screens: [
      {
        index: 0,
        displayID: 1,
        isMain: true,
        backingScaleFactor: 2,
        frame: { x: 100, y: 50, width: 1000, height: 500 },
        pixelSize: { width: 2000, height: 1000 },
      },
      {
        index: 1,
        displayID: 2,
        isMain: false,
        backingScaleFactor: 1,
        frame: { x: 1100, y: 50, width: 800, height: 600 },
        pixelSize: { width: 800, height: 600 },
      },
    ],
  },
  screenshot: { dimensions: { width: 2800, height: 1000 } },
  calibration: { screenshotMatchesMainScreen: false },
};

const global = resolveCoordinatePoint(
  { x: 300, y: 200 },
  { coordinate_space: 'global_display_points' },
  fakeCalibration,
);
console.log(`global point: ${JSON.stringify(global.point)}`);
console.log(`global display: ${global.transform.display.index}`);
console.log(`global pixel point: ${JSON.stringify(global.transform.displayPixelPoint)}`);

if (global.point.x !== 300 || global.point.y !== 200) throw new Error('global point should not be transformed');
if (global.transform.display.index !== 0) throw new Error('global point should resolve to display 0');
if (global.transform.displayPixelPoint.x !== 400 || global.transform.displayPixelPoint.y !== 300) {
  throw new Error(`unexpected global display pixel mapping: ${JSON.stringify(global.transform.displayPixelPoint)}`);
}

const screenshot = resolveCoordinatePoint(
  { x: 400, y: 300 },
  { coordinate_space: 'screenshot_pixels', display_index: 0 },
  fakeCalibration,
);
console.log(`screenshot point: ${JSON.stringify(screenshot.point)}`);
console.log(`screenshot display: ${screenshot.transform.display.index}`);
console.log(`screenshot scale: ${JSON.stringify(screenshot.transform.scale)}`);

if (screenshot.point.x !== 300 || screenshot.point.y !== 200) {
  throw new Error(`screenshot pixel point did not convert to expected display point: ${JSON.stringify(screenshot.point)}`);
}
if (screenshot.transform.scale.x !== 2 || screenshot.transform.scale.y !== 2) throw new Error('expected Retina scale 2');

const secondary = resolveCoordinatePoint(
  { x: 40, y: 60 },
  { coordinate_space: 'screenshot_pixels', display_index: 1 },
  fakeCalibration,
);
console.log(`secondary screenshot point: ${JSON.stringify(secondary.point)}`);
console.log(`secondary display: ${secondary.transform.display.index}`);

if (secondary.point.x !== 1140 || secondary.point.y !== 110) {
  throw new Error(`secondary display transform failed: ${JSON.stringify(secondary.point)}`);
}

const ambiguous = resolveCoordinatePoint(
  { x: 400, y: 300 },
  { coordinate_space: 'screenshot_pixels' },
  fakeCalibration,
);
console.log(`ambiguous warnings: ${JSON.stringify(ambiguous.transform.warnings)}`);

if (!ambiguous.transform.warnings.some((item) => item.includes('Multiple displays'))) {
  throw new Error('expected multi-display screenshot_pixels warning');
}

console.log('PASS smoke-coordinate-transform point coordinate conversion');
