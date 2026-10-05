/*
 * Browser port of the flash-analysis mechanics in Electronic Arts IRIS:
 * https://github.com/electronicarts/IRIS (BSD-3-Clause; see THIRD_PARTY_LICENSES.md).
 * Browser frame acquisition differs from IRIS's FFmpeg/OpenCV decoder.
 */
export const SAMPLE_RATE = 60;
export const FLASH_AREA = 0.25;
export const LUMINANCE_DELTA = 0.1;
export const RED_DELTA = 20;

const linear = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const value = i / 255;
  linear[i] = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function makeFrame(data) {
  const count = data.length / 4;
  const luminance = new Float32Array(count);
  const red = new Float32Array(count);
  let luminanceSum = 0;
  let redSum = 0;
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const r = linear[data[i]], g = linear[data[i + 1]], b = linear[data[i + 2]];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const redValue = r / (r + g + b) >= 0.8 ? Math.max(0, (r - g - b) * 320) : 0;
    luminance[p] = y;
    red[p] = redValue;
    luminanceSum += y;
    redSum += redValue;
  }
  return {
    luminance,
    red,
    luminanceMean: luminanceSum / count,
    redMean: redSum / count,
  };
}

// IRIS checks the changing area, then the change in the whole-frame average.
export function frameDifferences(previous, current) {
  if (!previous || previous.luminance.length !== current.luminance.length) {
    return { luminance: 0, red: 0, luminanceArea: 0, redArea: 0 };
  }
  let luminanceChanged = 0;
  let redChanged = 0;
  const count = current.luminance.length;
  for (let i = 0; i < count; i++) {
    if (Math.abs(current.luminance[i] - previous.luminance[i]) > 1e-6) luminanceChanged++;
    if (Math.abs(current.red[i] - previous.red[i]) > 1e-6) redChanged++;
  }
  const luminanceArea = luminanceChanged / count;
  const redArea = redChanged / count;
  return {
    luminance: luminanceArea >= FLASH_AREA ? current.luminanceMean - previous.luminanceMean : 0,
    red: redArea >= FLASH_AREA ? current.redMean - previous.redMean : 0,
    luminanceArea,
    redArea,
  };
}

class TransitionChannel {
  constructor(threshold, darkThreshold) {
    this.threshold = threshold;
    this.darkThreshold = darkThreshold;
    this.accumulated = 0;
    this.trend = [];
    this.transitions = [];
    this.eligibleSpans = [];
    this.lastTime = null;
    this.lastEligible = false;
    this.lastAlert = new Map();
  }

  add(time, diff, darkerMean) {
    // IRIS accumulates small changes in the same direction before testing
    // whether a transition threshold has been crossed.
    const sameDirection = diff === 0 || this.accumulated === 0
      || Math.sign(diff) === Math.sign(this.accumulated);
    const previousAccumulated = this.accumulated;
    if (!sameDirection) this.trend = [];
    this.trend.push({ time, diff });
    this.trend = this.trend.filter(entry => time - entry.time < 1);
    this.accumulated = this.trend.reduce((sum, entry) => sum + entry.diff, 0);
    const crossed = Math.abs(this.accumulated) >= this.threshold
      && (Math.sign(previousAccumulated) !== Math.sign(this.accumulated)
        || Math.abs(previousAccumulated) < this.threshold)
      && darkerMean < this.darkThreshold;
    if (crossed) this.transitions.push(time);
    this.transitions = this.transitions.filter(t => time - t < 1);
    const count = this.transitions.length;
    if (this.lastTime !== null && this.lastEligible && time > this.lastTime) {
      this.eligibleSpans.push({ start: this.lastTime, end: time });
    }
    const oldest = time - 5;
    this.eligibleSpans = this.eligibleSpans.filter(span => span.end > oldest);
    const eligibleSeconds = this.eligibleSpans.reduce(
      (sum, span) => sum + span.end - Math.max(span.start, oldest), 0);
    this.lastTime = time;
    this.lastEligible = count >= 4 && count <= 6;

    const levels = [];
    if (count > 6) levels.push('rapid');
    else if (count >= 4) levels.push('warning');
    if (eligibleSeconds >= 4 && count >= 4) levels.push('extended');
    return levels.filter(level => {
      const last = this.lastAlert.get(level) ?? -Infinity;
      if (time - last < 0.3) return false;
      this.lastAlert.set(level, time);
      return true;
    });
  }
}

export class IrisFlashDetector {
  constructor() {
    this.previous = null;
    this.luminance = new TransitionChannel(LUMINANCE_DELTA, 0.8);
    this.red = new TransitionChannel(RED_DELTA, 321);
    this.alerts = [];
  }

  addFrame(time, frame) {
    if (this.previous) {
      const differences = frameDifferences(this.previous, frame);
      for (const level of this.luminance.add(time, differences.luminance,
        Math.min(this.previous.luminanceMean, frame.luminanceMean))) {
        this.alerts.push({ time, kind: 'Brightness', level });
      }
      for (const level of this.red.add(time, differences.red,
        Math.min(this.previous.redMean, frame.redMean))) {
        this.alerts.push({ time, kind: 'Saturated red', level });
      }
    }
    this.previous = frame;
  }

  intervals(duration) {
    const intervals = [];
    for (const alert of this.alerts.sort((a, b) => a.time - b.time)) {
      const start = Math.max(0, alert.time - (alert.level === 'extended' ? 5 : 1.25));
      const end = Math.min(duration, alert.time + 0.5);
      const last = intervals.at(-1);
      if (last && start <= last.end + 0.5) {
        last.end = Math.max(last.end, end);
        if (!last.kinds.includes(alert.kind)) last.kinds.push(alert.kind);
        if (!last.levels.includes(alert.level)) last.levels.push(alert.level);
      } else {
        intervals.push({ start, end, kinds: [alert.kind], levels: [alert.level] });
      }
    }
    return intervals;
  }
}
