import test from 'node:test';
import assert from 'node:assert/strict';
import { scanVideoFrames } from './frame-stream.js';

class FakeVideo extends EventTarget {
  constructor(frames) {
    super();
    this.frames = frames;
    this.callback = null;
    this.seeks = 0;
    this.ended = false;
  }
  set currentTime(_value) { this.seeks++; }
  requestVideoFrameCallback(callback) { this.callback = callback; return 1; }
  cancelVideoFrameCallback() { this.callback = null; }
  getVideoPlaybackQuality() { return { droppedVideoFrames: 0 }; }
  async play() {
    queueMicrotask(() => {
      for (const frame of this.frames) {
        const callback = this.callback;
        this.callback = null;
        callback?.(0, frame);
      }
      this.ended = true;
      this.dispatchEvent(new Event('ended'));
    });
  }
  pause() {}
}

test('24-second scan consumes sequential frames with no seeks', async () => {
  const frames = Array.from({ length: 1440 }, (_, i) => ({
    mediaTime: i / 60, presentedFrames: i + 1,
  }));
  const video = new FakeVideo(frames);
  let analyzed = 0;
  const result = await scanVideoFrames(video, {
    signal: new AbortController().signal,
    onFrame: () => analyzed++,
  });
  assert.equal(video.seeks, 0);
  assert.equal(analyzed, 1440);
  assert.equal(result.callbackGaps, 0);
});

test('reports callbacks missed between presented frames', async () => {
  const video = new FakeVideo([
    { mediaTime: 0, presentedFrames: 1 },
    { mediaTime: 0.033, presentedFrames: 3 },
  ]);
  const result = await scanVideoFrames(video, {
    signal: new AbortController().signal,
    onFrame: () => {},
  });
  assert.equal(result.callbackGaps, 1);
});
