import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame, frameDifferences, IrisFlashDetector, FLASH_AREA } from './analyzer.js';

function solid(r, g, b, count = 100) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b, 255], i);
  return makeFrame(pixels);
}
function pulse(detector, low, high, cycles, halfPeriod) {
  detector.addFrame(0, low);
  for (let i = 1; i <= cycles * 2; i++) {
    detector.addFrame(i * halfPeriod, i % 2 ? high : low);
  }
}

test('linear RGB luminance and IRIS saturated-red coefficient', () => {
  assert.equal(solid(255, 255, 255).luminanceMean, 1);
  assert.equal(solid(255, 0, 0).redMean, 320);
  assert.equal(solid(255, 255, 0).redMean, 0);
});

test('IRIS area cutoff gates whole-frame average changes', () => {
  const black = solid(0, 0, 0);
  const pixels = new Uint8ClampedArray(400);
  for (let i = 0; i < 25; i++) pixels.set([255, 255, 255, 255], i * 4);
  const quarter = frameDifferences(black, makeFrame(pixels));
  assert.equal(quarter.luminanceArea, FLASH_AREA);
  assert.ok(quarter.luminance > 0);
  const below = new Uint8ClampedArray(400);
  for (let i = 0; i < 24; i++) below.set([255, 255, 255, 255], i * 4);
  assert.equal(frameDifferences(black, makeFrame(below)).luminance, 0);
});

test('rapid opposing changes produce brightness and red incidents', () => {
  const detector = new IrisFlashDetector();
  pulse(detector, solid(0, 0, 0), solid(255, 0, 0), 4, 0.1);
  assert.ok(detector.alerts.some(a => a.kind === 'Brightness' && a.level === 'rapid'));
  assert.ok(detector.alerts.some(a => a.kind === 'Saturated red' && a.level === 'rapid'));
  assert.equal(detector.intervals(2).length, 1);
});

test('slow repeated flashes trigger an extended incident', () => {
  const detector = new IrisFlashDetector();
  const low = solid(0, 0, 0), high = solid(255, 255, 255);
  detector.addFrame(0, low);
  for (let i = 1; i <= 320; i++) {
    const time = i / 60;
    detector.addFrame(time, Math.floor(time * 5) % 2 ? high : low);
  }
  assert.ok(detector.alerts.some(a => a.level === 'extended'));
  assert.ok(!detector.alerts.some(a => a.level === 'rapid'));
});

test('unchanging frames do not flag', () => {
  const detector = new IrisFlashDetector();
  for (let i = 0; i < 120; i++) detector.addFrame(i / 60, solid(128, 128, 128));
  assert.deepEqual(detector.alerts, []);
});

test('small same-direction changes accumulate through an unchanged frame', () => {
  const detector = new IrisFlashDetector();
  detector.addFrame(0, solid(0, 0, 0));
  detector.addFrame(0.1, solid(70, 70, 70));
  detector.addFrame(0.2, solid(70, 70, 70));
  detector.addFrame(0.3, solid(95, 95, 95));
  assert.equal(detector.luminance.transitions.length, 1);
});
