import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeFrame, IrisAnalyzer } from '../analyzer.js';

const file = 'fixtures/POTENTIAL_TRIGGER_ALL_FEATURES_DO_NOT_PLAY.webm';
const width = 160, height = 90, fps = 60;
const decoded = spawnSync('ffmpeg', [
  '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'
], { maxBuffer: 120 * 1024 * 1024 });
if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || 'ffmpeg decode failed');
const frameBytes = width * height * 4;
assert.equal(decoded.stdout.length, 24 * fps * frameBytes, 'fixture duration or resolution changed');
const detector = new IrisAnalyzer(width, height);
for (let frame = 0; frame < 24 * fps; frame++) {
  const pixels = decoded.stdout.subarray(frame * frameBytes, (frame + 1) * frameBytes);
  detector.addFrame(frame / fps, makeFrame(pixels));
}
const alerts = [...detector.flash.alerts, ...detector.pattern.alerts];
function expectAlert(kind, level, start, end) {
  const match = alerts.find(alert => alert.kind === kind && alert.level === level
    && alert.time >= start && alert.time < end);
  assert.ok(match, `expected ${kind} ${level} alert from ${start}s to ${end}s`);
  return match;
}
const found = [
  expectAlert('Brightness', 'rapid', 1, 3),
  expectAlert('Saturated red', 'rapid', 6, 8),
  expectAlert('Brightness', 'extended', 12, 17),
  expectAlert('Spatial pattern', 'pattern', 21, 23),
];
assert.equal(alerts.filter(alert => alert.time < 1).length, 0, 'clean lead-in should not alert');
const intervals = detector.intervals(24);
assert.ok(intervals.length >= 4, 'scenes should have separate playback warnings');
assert.ok(intervals.some(interval => interval.kinds.includes('Spatial pattern') && interval.end >= 23));
console.log(found.map(alert => `${alert.kind} ${alert.level}: ${alert.time.toFixed(2)}s`).join('\n'));
console.log(`${intervals.length} playback warning interval(s) verified`);
