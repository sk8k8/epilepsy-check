import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame, frameTransitions, FlashTracker } from './analyzer.js';

function solid(r, g, b, count = 100) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b, 255], i);
  return makeFrame(pixels);
}

test('detects opposing brightness transitions and warns above three flashes in one second', () => {
  const black = solid(0, 0, 0), white = solid(255, 255, 255);
  const tracker = new FlashTracker();
  let previous = black;
  for (let i = 1; i <= 8; i++) {
    const next = i % 2 ? white : black;
    tracker.add(i * 0.1, frameTransitions(previous, next));
    previous = next;
  }
  assert.equal(tracker.alerts[0].kind, 'Brightness');
  assert.equal(tracker.intervals(3).length, 1);
});

test('does not warn for slow flashes or small changing areas', () => {
  const black = solid(0, 0, 0), white = solid(255, 255, 255);
  const slow = new FlashTracker();
  let previous = black;
  for (let i = 1; i <= 8; i++) {
    const next = i % 2 ? white : black;
    slow.add(i * 0.6, frameTransitions(previous, next));
    previous = next;
  }
  assert.equal(slow.alerts.length, 0);
  const small = new Uint8ClampedArray(400);
  small.fill(255, 0, 4 * 10);
  assert.deepEqual(frameTransitions(black, makeFrame(small)), []);
});

test('detects repeated saturated red transitions', () => {
  const black = solid(0, 0, 0), red = solid(255, 0, 0);
  const tracker = new FlashTracker();
  let previous = black;
  for (let i = 1; i <= 8; i++) {
    const next = i % 2 ? red : black;
    tracker.add(i * 0.1, frameTransitions(previous, next));
    previous = next;
  }
  assert.ok(tracker.alerts.some(alert => alert.kind === 'Saturated red'));
});
