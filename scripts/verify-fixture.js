import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeFrame, IrisAnalyzer } from '../analyzer.js';

const file = 'fixtures/POTENTIAL_SEIZURE_TRIGGER_DO_NOT_PLAY.webm';
const width = 160, height = 90, fps = 60;
const decoded = spawnSync('ffmpeg', [
  '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'
], { maxBuffer: 32 * 1024 * 1024 });
if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || 'ffmpeg decode failed');
const frameBytes = width * height * 4;
assert.equal(decoded.stdout.length % frameBytes, 0);
const detector = new IrisAnalyzer(width, height);
for (let frame = 0; frame < decoded.stdout.length / frameBytes; frame++) {
  const pixels = decoded.stdout.subarray(frame * frameBytes, (frame + 1) * frameBytes);
  detector.addFrame(frame / fps, makeFrame(pixels));
}
const rapid = detector.flash.alerts.find(alert => alert.kind === 'Brightness' && alert.level === 'rapid');
assert.ok(rapid, 'fixture must trigger a rapid brightness alert');
assert.equal(detector.pattern.alerts.length, 0, 'uniform flashing frames must not trigger the spatial-pattern detector');
console.log(`Verified: ${detector.flash.alerts.length} flash alerts, no pattern alerts; first rapid brightness alert at ${rapid.time.toFixed(2)}s`);
