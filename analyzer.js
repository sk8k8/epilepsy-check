// A conservative screening heuristic. It is not a WCAG conformance test.
export const SAMPLE_RATE = 30;
export const FLASH_AREA = 0.2;
export const LUMINANCE_DELTA = 0.1;

const linear = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const value = i / 255;
  linear[i] = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function makeFrame(data) {
  const count = data.length / 4;
  const luminance = new Float32Array(count);
  const red = new Uint8Array(count);
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const r = linear[data[i]], g = linear[data[i + 1]], b = linear[data[i + 2]];
    luminance[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // A simple saturated-red screen; not the WCAG CIE chromaticity calculation.
    red[p] = data[i] > 80 && data[i] / Math.max(1, data[i] + data[i + 1] + data[i + 2]) >= 0.8 ? 1 : 0;
  }
  return { luminance, red };
}

export function frameTransitions(previous, current) {
  if (!previous || previous.luminance.length !== current.luminance.length) return [];
  const count = current.luminance.length;
  let brighter = 0, darker = 0, redIn = 0, redOut = 0;
  for (let i = 0; i < count; i++) {
    const oldY = previous.luminance[i];
    const newY = current.luminance[i];
    if (Math.min(oldY, newY) < 0.8 && Math.abs(newY - oldY) >= LUMINANCE_DELTA) {
      if (newY > oldY) brighter++;
      else darker++;
    }
    if (previous.red[i] !== current.red[i]) {
      if (current.red[i]) redIn++;
      else redOut++;
    }
  }
  const result = [];
  if (brighter / count >= FLASH_AREA) result.push({ kind: 'Brightness', direction: 1, area: brighter / count });
  if (darker / count >= FLASH_AREA) result.push({ kind: 'Brightness', direction: -1, area: darker / count });
  if (redIn / count >= FLASH_AREA) result.push({ kind: 'Saturated red', direction: 1, area: redIn / count });
  if (redOut / count >= FLASH_AREA) result.push({ kind: 'Saturated red', direction: -1, area: redOut / count });
  return result;
}

export class FlashTracker {
  constructor() {
    this.pending = new Map();
    this.flashes = new Map();
    this.alerts = [];
    this.lastAlert = new Map();
  }

  add(time, transitions) {
    for (const transition of transitions) {
      const { kind, direction } = transition;
      const pending = this.pending.get(kind);
      if (pending && pending.direction !== direction && time - pending.time <= 0.5) {
        const flashes = (this.flashes.get(kind) || []).filter(t => time - t < 1);
        flashes.push(time);
        this.flashes.set(kind, flashes);
        this.pending.delete(kind);
        if (flashes.length >= 4 && time - (this.lastAlert.get(kind) ?? -Infinity) > 0.25) {
          this.alerts.push({ time, kind, count: flashes.length });
          this.lastAlert.set(kind, time);
        }
      } else {
        this.pending.set(kind, { time, direction });
      }
    }
  }

  intervals(duration) {
    const intervals = [];
    for (const alert of this.alerts) {
      const start = Math.max(0, alert.time - 1.25);
      const end = Math.min(duration, alert.time + 0.5);
      const last = intervals.at(-1);
      if (last && start <= last.end + 0.5) {
        last.end = Math.max(last.end, end);
        if (!last.kinds.includes(alert.kind)) last.kinds.push(alert.kind);
      } else {
        intervals.push({ start, end, kinds: [alert.kind] });
      }
    }
    return intervals;
  }
}
