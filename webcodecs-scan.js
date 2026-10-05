import { demuxWebM } from './webm.js';

function abortError() { return new DOMException('Cancelled', 'AbortError'); }

export async function scanWebMFile(file, { signal, onFrame, onProgress = () => {},
  Decoder = globalThis.VideoDecoder, Chunk = globalThis.EncodedVideoChunk }) {
  if (signal.aborted) throw abortError();
  if (!Decoder || !Chunk) throw new Error('This browser does not support direct WebM frame decoding.');
  const track = demuxWebM(await file.arrayBuffer());
  if (signal.aborted) throw abortError();
  const codec = track.codecId === 'V_VP9' ? 'vp09.00.20.08' : 'vp8';
  const config = { codec, codedWidth: track.width, codedHeight: track.height };
  if (!(await Decoder.isConfigSupported(config)).supported) {
    throw new Error(`This browser cannot decode ${track.codecId} through WebCodecs.`);
  }
  if (signal.aborted) throw abortError();

  let decoder;
  let failed = null;
  let decoded = 0;
  let lastTimestamp = -1;
  let lastProgress = -Infinity;
  const fail = error => { failed ||= error; };
  const aborted = () => fail(abortError());
  signal.addEventListener('abort', aborted, { once: true });
  try {
    decoder = new Decoder({
      output(frame) {
        try {
          if (failed) return;
          if (frame.timestamp <= lastTimestamp) throw new Error('Decoded frames arrived out of order.');
          lastTimestamp = frame.timestamp;
          onFrame(frame);
          decoded++;
          if (frame.timestamp / 1e6 - lastProgress >= 0.25) {
            lastProgress = frame.timestamp / 1e6;
            onProgress(lastProgress, decoded);
          }
        } catch (error) { fail(error); }
        finally { frame.close(); }
      },
      error: fail,
    });
    decoder.configure(config);
    for (const frame of track.frames) {
      if (failed) throw failed;
      while (decoder.decodeQueueSize >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (failed) throw failed;
      }
      decoder.decode(new Chunk(frame));
    }
    await decoder.flush();
    if (failed) throw failed;
    if (decoded !== track.frames.length) {
      throw new Error(`Scan incomplete: decoded ${decoded} of ${track.frames.length} video frames.`);
    }
    return { analyzedFrames: decoded, callbackGaps: 0, droppedFrames: 0 };
  } finally {
    signal.removeEventListener('abort', aborted);
    if (decoder && decoder.state !== 'closed') decoder.close();
  }
}
