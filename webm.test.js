import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demuxWebM } from './webm.js';

const fixture = new Uint8Array(readFileSync('fixtures/POTENTIAL_TRIGGER_ALL_FEATURES_DO_NOT_PLAY.webm'));

test('demuxes every encoded frame from the all-features fixture', () => {
  const track = demuxWebM(fixture);
  assert.equal(track.codecId, 'V_VP9');
  assert.equal(track.width, 160);
  assert.equal(track.height, 90);
  assert.equal(track.frames.length, 1440);
  assert.equal(track.frames[0].type, 'key');
  assert.ok(track.frames[0].timestamp >= 0);
  for (let i = 1; i < track.frames.length; i++) {
    assert.ok(track.frames[i].timestamp > track.frames[i - 1].timestamp);
  }
  assert.ok(track.frames.at(-1).timestamp < 24_000_000);
});
