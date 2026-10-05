import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePattern, IrisPatternDetector } from './pattern.js';
import { IrisAnalyzer, makeFrame } from './analyzer.js';

const width = 128, height = 64;
function luminance(type) {
  const frame = new Float32Array(width * height);
  let random = 123;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (type === 'vertical') frame[y * width + x] = Math.floor(x / 8) % 2;
      else if (type === 'horizontal') frame[y * width + x] = Math.floor(y / 8) % 2;
      else if (type === 'diagonal') frame[y * width + x] = Math.floor((x + y) / 8) % 2;
      else if (type === 'noise') {
        random = (random * 1664525 + 1013904223) >>> 0;
        frame[y * width + x] = random / 2 ** 32;
      } else frame[y * width + x] = 0.5;
    }
  }
  return frame;
}
function rgbaFromLuminance(values) {
  const rgba = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const value = Math.round(values[i] * 255);
    rgba.set([value, value, value, 255], i * 4);
  }
  return rgba;
}

test('frequency and region analysis detects repeated stripes in three orientations', () => {
  for (const type of ['vertical', 'horizontal', 'diagonal']) {
    const result = analyzePattern(luminance(type), width, height, width, height);
    assert.ok(result, `${type} pattern should be detected`);
    assert.ok(result.stripes >= 6);
    assert.ok(result.area >= 0.25);
  }
});

test('uniform frames and deterministic noise are not flagged', () => {
  for (const type of ['plain', 'noise']) {
    assert.equal(analyzePattern(luminance(type), width, height, width, height), null);
  }
});

test('pattern needs half a second and interval remains active while pattern remains', () => {
  const detector = new IrisPatternDetector(width, height);
  const stripes = { luminance: luminance('vertical') };
  for (let step = 0; step < 5; step++) detector.addFrame(step * 0.1, stripes);
  assert.equal(detector.alerts.length, 0);
  for (let step = 5; step <= 10; step++) detector.addFrame(step * 0.1, stripes);
  assert.equal(detector.alerts.length, 1);
  assert.ok(detector.alerts[0].end >= 1);
  detector.addFrame(1.1, { luminance: luminance('plain') });
  assert.equal(detector.alerts.length, 1);
});

test('combined analyzer puts a sustained pattern on the playback timeline', () => {
  const detector = new IrisAnalyzer(width, height);
  const stripes = makeFrame(rgbaFromLuminance(luminance('horizontal')));
  for (let step = 0; step <= 15; step++) detector.addFrame(step / 15, stripes);
  const interval = detector.intervals(2)[0];
  assert.ok(interval.kinds.includes('Spatial pattern'));
  assert.equal(interval.start, 0);
  assert.ok(interval.end >= 1);
});
