import { makeFrame, IrisAnalyzer } from './analyzer.js';
import { scanVideoFrames } from './frame-stream.js';
import { scanWebMFile } from './webcodecs-scan.js';

const $ = id => document.getElementById(id);
const fileInput = $('file-input');
const scanner = $('scanner');
const player = $('player');
const canvas = $('analysis-canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
let fileURL = null;
let selectedFile = null;
let scanController = null;
let intervals = [];
let activeWarning = null;
let bypassed = null;

function formatTime(seconds) {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function setStatus(message) { $('scan-status').textContent = message; }
function chooseFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) {
    setStatus('Choose a video file.');
    return;
  }
  scanController?.abort();
  scanner.pause();
  player.pause();
  scanner.removeAttribute('src');
  player.removeAttribute('src');
  scanner.load();
  player.load();
  if (fileURL) URL.revokeObjectURL(fileURL);
  fileURL = URL.createObjectURL(file);
  selectedFile = file;
  intervals = [];
  activeWarning = null;
  bypassed = null;
  $('file-name').textContent = file.name;
  $('file-size').textContent = `${(file.size / 1048576).toFixed(1)} MB`;
  $('file-details').classList.remove('is-hidden');
  $('scan-section').classList.remove('is-hidden');
  $('results-section').classList.add('is-hidden');
  $('warning').classList.add('is-hidden');
  $('scan-button').disabled = false;
  $('scan-button').classList.remove('is-hidden');
  $('cancel-button').classList.add('is-hidden');
  $('progress-bar').classList.add('is-hidden');
  $('progress-bar').value = 0;
  setStatus('Ready to scan');
}
fileInput.addEventListener('change', event => chooseFile(event.target.files?.[0]));
const dropzone = $('dropzone');
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, event => {
  event.preventDefault();
  dropzone.classList.add('dragging');
});
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, event => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
});
dropzone.addEventListener('drop', event => chooseFile([...event.dataTransfer.files].find(file => file.type.startsWith('video/'))));

function waitFor(video, successEvent, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(successEvent, success);
      video.removeEventListener('error', failure);
      signal.removeEventListener('abort', cancelled);
    };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('This browser could not decode the video.')); };
    const cancelled = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    video.addEventListener(successEvent, success, { once: true });
    video.addEventListener('error', failure, { once: true });
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}
function showResults(duration, tracker) {
  intervals = tracker.intervals(duration);
  $('results-section').classList.remove('is-hidden');
  const banner = $('result-banner');
  banner.classList.toggle('is-warning', intervals.length > 0);
  banner.classList.toggle('is-success', intervals.length === 0);
  banner.textContent = intervals.length
    ? `${intervals.length} section${intervals.length === 1 ? '' : 's'} flagged for possible flashes or spatial patterns. Review the times below before playback.`
    : 'No flash or spatial-pattern sections were flagged in sampled frames. Other triggers may still be present.';
  const timeline = $('timeline');
  timeline.replaceChildren();
  timeline.classList.toggle('is-hidden', intervals.length === 0);
  const findings = $('findings');
  findings.replaceChildren();
  for (const interval of intervals) {
    const mark = document.createElement('span');
    mark.style.left = `${100 * interval.start / duration}%`;
    mark.style.width = `${Math.max(0.5, 100 * (interval.end - interval.start) / duration)}%`;
    timeline.append(mark);
    const item = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'tag is-warning is-light time-chip';
    time.textContent = `${formatTime(interval.start)}–${formatTime(interval.end)}`;
    item.append(time, document.createTextNode(`${interval.kinds.join(' + ')} · ${interval.levels.join(', ')}`));
    findings.append(item);
  }
  player.src = fileURL;
  player.load();
  if (intervals.some(interval => interval.start === 0)) showWarning(intervals[0]);
}

async function scan() {
  if (!selectedFile || scanController) return;
  const controller = new AbortController();
  scanController = controller;
  const { signal } = controller;
  $('scan-button').classList.add('is-hidden');
  $('cancel-button').classList.remove('is-hidden');
  $('progress-bar').classList.remove('is-hidden');
  $('results-section').classList.add('is-hidden');
  setStatus('Reading video…');
  try {
    scanner.src = fileURL;
    scanner.load();
    if (scanner.readyState < 1) await waitFor(scanner, 'loadedmetadata', signal);
    const duration = scanner.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video has no readable duration.');
    const aspect = scanner.videoWidth / scanner.videoHeight;
    if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('This video has no readable dimensions.');
    const scale = Math.min(1, 256 / Math.max(scanner.videoWidth, scanner.videoHeight));
    canvas.width = Math.max(1, Math.round(scanner.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(scanner.videoHeight * scale));
    const tracker = new IrisAnalyzer(canvas.width, canvas.height);
    const direct = /\.webm$/i.test(selectedFile.name) || selectedFile.type === 'video/webm';
    const coverage = await (direct ? scanWebMFile(selectedFile, {
      signal,
      onFrame: videoFrame => {
        context.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
        const frame = makeFrame(context.getImageData(0, 0, canvas.width, canvas.height).data);
        tracker.addFrame(videoFrame.timestamp / 1e6, frame);
      },
      onProgress: time => {
        const percent = Math.min(100, Math.round(100 * time / duration));
        $('progress-bar').value = percent;
        setStatus(`Scanning ${formatTime(time)} / ${formatTime(duration)} · ${percent}%`);
      },
    }) : scanVideoFrames(scanner, {
      signal,
      onFrame: metadata => {
        context.drawImage(scanner, 0, 0, canvas.width, canvas.height);
        const frame = makeFrame(context.getImageData(0, 0, canvas.width, canvas.height).data);
        tracker.addFrame(metadata.mediaTime, frame);
      },
      onProgress: time => {
        const percent = Math.min(100, Math.round(100 * time / duration));
        $('progress-bar').value = percent;
        setStatus(`Scanning ${formatTime(time)} / ${formatTime(duration)} · ${percent}%`);
      },
    }));
    const missed = Math.max(coverage.callbackGaps, coverage.droppedFrames);
    if (missed) throw new Error(`Scan incomplete: the browser skipped at least ${missed} frames. Try a WebM VP8/VP9 file in a browser with WebCodecs support.`);
    $('progress-bar').value = 100;
    setStatus(`Scan complete · ${coverage.analyzedFrames} frames checked`);
    showResults(duration, tracker);
  } catch (error) {
    setStatus(error.name === 'AbortError' ? 'Scan cancelled' : error.message || 'The scan could not finish.');
  } finally {
    scanner.pause();
    scanner.removeAttribute('src');
    scanner.load();
    if (scanController === controller) scanController = null;
    $('scan-button').classList.remove('is-hidden');
    $('cancel-button').classList.add('is-hidden');
  }
}
$('scan-button').addEventListener('click', scan);
$('cancel-button').addEventListener('click', () => scanController?.abort());

function showWarning(interval) {
  if (activeWarning === interval) return;
  activeWarning = interval;
  player.pause();
  $('warning-description').textContent = `A possible visual trigger (${interval.kinds.join(', ')}) was flagged around ${formatTime(interval.start)}–${formatTime(interval.end)}. Skip this section or choose to continue.`;
  $('warning').classList.remove('is-hidden');
  $('skip-button').focus();
}
function checkRisk() {
  if (!intervals.length || activeWarning) return;
  const now = player.currentTime;
  if (bypassed && now >= bypassed.end) bypassed = null;
  const interval = intervals.find(part => now >= Math.max(0, part.start - 0.15) && now < part.end);
  if (interval && interval !== bypassed) showWarning(interval);
}
for (const event of ['timeupdate', 'seeked', 'play']) player.addEventListener(event, checkRisk);
$('skip-button').addEventListener('click', () => {
  if (!activeWarning) return;
  const end = activeWarning.end;
  bypassed = activeWarning;
  activeWarning = null;
  $('warning').classList.add('is-hidden');
  player.currentTime = Math.min(end + 0.1, player.duration || end + 0.1);
  player.play().catch(() => {});
});
$('continue-button').addEventListener('click', () => {
  bypassed = activeWarning;
  activeWarning = null;
  $('warning').classList.add('is-hidden');
  player.play().catch(() => {});
});
window.addEventListener('beforeunload', () => { if (fileURL) URL.revokeObjectURL(fileURL); });
