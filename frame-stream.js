// Decode sequentially through the browser's media pipeline. A separate seek
// for every analysis sample can take hundreds of milliseconds per frame.
export function scanVideoFrames(video, { signal, onFrame, onProgress = () => {} }) {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return Promise.reject(new Error('This browser does not support video frame callbacks.'));
  }
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));

  return new Promise((resolve, reject) => {
    let callbackId = null;
    let stallTimer = null;
    let lastPresented = null;
    let lastProgressTime = -Infinity;
    let analyzedFrames = 0;
    let callbackGaps = 0;
    let finished = false;
    const initialDropped = video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;

    function cleanup() {
      clearTimeout(stallTimer);
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      video.removeEventListener('ended', ended);
      video.removeEventListener('error', errored);
      signal.removeEventListener('abort', aborted);
      video.pause();
    }
    function finish(error) {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve({
        analyzedFrames,
        callbackGaps,
        droppedFrames: Math.max(0,
          (video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0) - initialDropped),
      });
    }
    const ended = () => finish();
    const errored = () => finish(new Error('The browser could not decode this video.'));
    const aborted = () => finish(new DOMException('Cancelled', 'AbortError'));
    function armStallTimer() {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => finish(new Error(
        'Video decoding stalled. Keep this tab active and try again.')), 10000);
    }
    function nextFrame(_now, metadata) {
      if (finished) return;
      callbackId = null;
      try {
        if (lastPresented !== null) {
          callbackGaps += Math.max(0, metadata.presentedFrames - lastPresented - 1);
        }
        lastPresented = metadata.presentedFrames;
        onFrame(metadata);
        analyzedFrames++;
        if (metadata.mediaTime - lastProgressTime >= 0.25) {
          lastProgressTime = metadata.mediaTime;
          onProgress(metadata.mediaTime, analyzedFrames);
        }
        armStallTimer();
        callbackId = video.requestVideoFrameCallback(nextFrame);
      } catch (error) {
        finish(error);
      }
    }

    video.addEventListener('ended', ended, { once: true });
    video.addEventListener('error', errored, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    video.muted = true;
    video.playbackRate = 1;
    armStallTimer();
    callbackId = video.requestVideoFrameCallback(nextFrame);
    try {
      Promise.resolve(video.play()).catch(error => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}
