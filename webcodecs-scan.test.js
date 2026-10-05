import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanWebMFile } from './webcodecs-scan.js';

const bytes = readFileSync('fixtures/POTENTIAL_TRIGGER_ALL_FEATURES_DO_NOT_PLAY.webm');
const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
class Chunk {
  constructor(frame) { Object.assign(this, frame); }
}
function decoderClass({ omitLast = false } = {}) {
  return class Decoder {
    static async isConfigSupported(config) {
      assert.equal(config.codec, 'vp09.00.20.08');
      return { supported: true };
    }
    constructor(callbacks) { this.callbacks = callbacks; this.decodeQueueSize = 0; this.state = 'unconfigured'; this.pending = []; }
    configure() { this.state = 'configured'; }
    decode(chunk) {
      this.decodeQueueSize++;
      const pending = Promise.resolve().then(() => {
        this.decodeQueueSize--;
        if (!omitLast || chunk.timestamp !== 23_983_000) {
          this.callbacks.output({ timestamp: chunk.timestamp, close() {} });
        }
      });
      this.pending.push(pending);
    }
    async flush() { await Promise.all(this.pending); }
    close() { this.state = 'closed'; }
  };
}

test('direct scan delivers all fixture frames in timestamp order', async () => {
  const times = [];
  const coverage = await scanWebMFile(file, {
    signal: new AbortController().signal,
    Decoder: decoderClass(), Chunk,
    onFrame: frame => times.push(frame.timestamp),
  });
  assert.equal(coverage.analyzedFrames, 1440);
  assert.equal(coverage.callbackGaps, 0);
  assert.ok(times.every((time, index) => index === 0 || time > times[index - 1]));
});

test('direct scan rejects missing decoded frames', async () => {
  const Decoder = decoderClass({ omitLast: true });
  await assert.rejects(scanWebMFile(file, {
    signal: new AbortController().signal,
    Decoder, Chunk, onFrame() {},
  }), /Scan incomplete/);
});

test('direct scan respects cancellation before reading', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanWebMFile(file, {
    signal: controller.signal, Decoder: decoderClass(), Chunk, onFrame() {},
  }), { name: 'AbortError' });
});
