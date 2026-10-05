import { SAMPLE_RATE, makeFrame, frameTransitions, FlashTracker } from './analyzer.js';

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
  $('file-details').classList.remove('hidden');
  $('scan-section').classList.remove('hidden');
  $('results-section').classList.add('hidden');
  $('warning').classList.add('hidden');
  $('scan-button').disabled = false;
  $('scan-button').classList.remove('hidden');
  $('cancel-button').classList.add('hidden');
  $('progress-wrap').classList.add('hidden');
  $('progress-bar').style.width = '0%';
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
async function seekTo(time, signal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (time === 0 && scanner.readyState < 2) {
    await waitFor(scanner, 'loadeddata', signal);
    return;
  }
  if (Math.abs(scanner.currentTime - time) < 0.0005 && scanner.readyState >= 2) return;
  const pending = waitFor(scanner, 'seeked', signal);
  scanner.currentTime = time;
  await pending;
}
function showResults(duration, tracker) {
  intervals = tracker.intervals(duration);
  $('results-section').classList.remove('hidden');
  const banner = $('result-banner');
  banner.classList.toggle('flagged', intervals.length > 0);
  banner.textContent = intervals.length
    ? `${intervals.length} section${intervals.length === 1 ? '' : 's'} flagged for possible rapid flashes. Review the times below before playback.`
    : 'No rapid flash sections were flagged in sampled frames. Other triggers may still be present.';
  const timeline = $('timeline');
  timeline.replaceChildren();
  timeline.classList.toggle('hidden', intervals.length === 0);
  const findings = $('findings');
  findings.replaceChildren();
  for (const interval of intervals) {
    const mark = document.createElement('span');
    mark.style.left = `${100 * interval.start / duration}%`;
    mark.style.width = `${Math.max(0.5, 100 * (interval.end - interval.start) / duration)}%`;
    timeline.append(mark);
    const item = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'time-chip';
    time.textContent = `${formatTime(interval.start)}–${formatTime(interval.end)}`;
    item.append(time, document.createTextNode(interval.kinds.join(' + ') + ' flashes'));
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
  $('scan-button').classList.add('hidden');
  $('cancel-button').classList.remove('hidden');
  $('progress-wrap').classList.remove('hidden');
  $('results-section').classList.add('hidden');
  setStatus('Reading video…');
  try {
    scanner.src = fileURL;
    scanner.load();
    if (scanner.readyState < 1) await waitFor(scanner, 'loadedmetadata', signal);
    const duration = scanner.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video has no readable duration.');
    const count = Math.ceil(duration * SAMPLE_RATE);
    const tracker = new FlashTracker();
    let previous = null;
    for (let i = 0; i <= count; i++) {
      const time = Math.min(i / SAMPLE_RATE, Math.max(0, duration - 0.001));
      await seekTo(time, signal);
      context.drawImage(scanner, 0, 0, canvas.width, canvas.height);
      const frame = makeFrame(context.getImageData(0, 0, canvas.width, canvas.height).data);
      if (previous) tracker.add(time, frameTransitions(previous, frame));
      previous = frame;
      if (i % 10 === 0 || i === count) {
        const percent = Math.round(100 * i / count);
        $('progress-bar').style.width = `${percent}%`;
        setStatus(`Scanning ${formatTime(time)} / ${formatTime(duration)} · ${percent}%`);
        // Let the UI update during fast decodes.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    setStatus('Scan complete');
    showResults(duration, tracker);
  } catch (error) {
    setStatus(error.name === 'AbortError' ? 'Scan cancelled' : error.message || 'The scan could not finish.');
  } finally {
    scanner.pause();
    scanner.removeAttribute('src');
    scanner.load();
    if (scanController === controller) scanController = null;
    $('scan-button').classList.remove('hidden');
    $('cancel-button').classList.add('hidden');
  }
}
$('scan-button').addEventListener('click', scan);
$('cancel-button').addEventListener('click', () => scanController?.abort());

function showWarning(interval) {
  if (activeWarning === interval) return;
  activeWarning = interval;
  player.pause();
  $('warning-description').textContent = `${interval.kinds.join(' and ')} flashes were flagged around ${formatTime(interval.start)}–${formatTime(interval.end)}. Skip this section or choose to continue.`;
  $('warning').classList.remove('hidden');
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
  $('warning').classList.add('hidden');
  player.currentTime = Math.min(end + 0.1, player.duration || end + 0.1);
  player.play().catch(() => {});
});
$('continue-button').addEventListener('click', () => {
  bypassed = activeWarning;
  activeWarning = null;
  $('warning').classList.add('hidden');
  player.play().catch(() => {});
});
window.addEventListener('beforeunload', () => { if (fileURL) URL.revokeObjectURL(fileURL); });
