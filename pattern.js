/*
 * Browser adaptation of IRIS PatternDetection.cpp's frequency-filter,
 * connected-region, and half-second persistence pipeline.
 * https://github.com/electronicarts/IRIS — BSD-3-Clause; see THIRD_PARTY_LICENSES.md.
 * The transform size and region grouping differ from OpenCV's implementation.
 */
const MIN_STRIPES = 6;
const MIN_AREA = 0.25;
const MIN_LIGHT = 0.25;
const HOLD_SECONDS = 0.5;

function powerOfTwoAtMost(value) {
  let size = 1;
  while (size * 2 <= value) size *= 2;
  return Math.max(32, size);
}

function fft1d(real, imaginary, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepR = Math.cos(angle), stepI = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let factorR = 1, factorI = 0;
      for (let j = 0; j < length / 2; j++) {
        const even = start + j, odd = even + length / 2;
        const oddR = real[odd] * factorR - imaginary[odd] * factorI;
        const oddI = real[odd] * factorI + imaginary[odd] * factorR;
        real[odd] = real[even] - oddR;
        imaginary[odd] = imaginary[even] - oddI;
        real[even] += oddR;
        imaginary[even] += oddI;
        const nextR = factorR * stepR - factorI * stepI;
        factorI = factorR * stepI + factorI * stepR;
        factorR = nextR;
      }
    }
  }
}

function fft2d(real, imaginary, width, height, inverse = false) {
  const rowR = new Float64Array(width), rowI = new Float64Array(width);
  const colR = new Float64Array(height), colI = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      rowR[x] = real[offset + x];
      rowI[x] = imaginary[offset + x];
    }
    fft1d(rowR, rowI, inverse);
    for (let x = 0; x < width; x++) {
      real[offset + x] = rowR[x];
      imaginary[offset + x] = rowI[x];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colR[y] = real[y * width + x];
      colI[y] = imaginary[y * width + x];
    }
    fft1d(colR, colI, inverse);
    for (let y = 0; y < height; y++) {
      real[y * width + x] = colR[y];
      imaginary[y * width + x] = colI[y];
    }
  }
}

function normalizeToBytes(values) {
  let min = Infinity, max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const result = new Uint8Array(values.length);
  if (max <= min) return result;
  const scale = 255 / (max - min);
  for (let i = 0; i < values.length; i++) result[i] = Math.round((values[i] - min) * scale);
  return result;
}

function otsu(values) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * histogram[i];
  let backgroundCount = 0, backgroundSum = 0, best = -1, threshold = 0;
  for (let i = 0; i < 256; i++) {
    backgroundCount += histogram[i];
    if (!backgroundCount) continue;
    const foregroundCount = values.length - backgroundCount;
    if (!foregroundCount) break;
    backgroundSum += i * histogram[i];
    const diff = backgroundSum / backgroundCount - (total - backgroundSum) / foregroundCount;
    const variance = backgroundCount * foregroundCount * diff * diff;
    if (variance > best) { best = variance; threshold = i; }
  }
  return threshold;
}

function sampleLuminance(luminance, sourceWidth, sourceHeight, width, height) {
  const result = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / width));
      result[y * width + x] = luminance[sy * sourceWidth + sx];
    }
  }
  return result;
}

function components(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const found = [];
  const minimum = mask.length * 0.00155;
  for (let initial = 0; initial < mask.length; initial++) {
    if (!mask[initial] || visited[initial]) continue;
    visited[initial] = 1;
    queue[0] = initial;
    let head = 0, tail = 1, minX = width, maxX = 0, minY = height, maxY = 0;
    let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
      for (const neighbor of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
        y ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (neighbor >= 0 && mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    if (tail < minimum) continue;
    const xx = sumXX / tail - (sumX / tail) ** 2;
    const yy = sumYY / tail - (sumY / tail) ** 2;
    const xy = sumXY / tail - sumX * sumY / (tail * tail);
    const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
    const major = (xx + yy + discriminant) / 2;
    const minor = (xx + yy - discriminant) / 2;
    if (major < 8 || major / Math.max(1, minor) < 4) continue;
    found.push({ minX, maxX, minY, maxY, angle: Math.atan2(2 * xy, xx - yy) / 2 });
  }
  return found;
}

function groupedRegion(parts, luminance, width, height) {
  let best = null;
  for (const seed of parts) {
    const group = parts.filter(part => Math.abs(Math.sin(part.angle - seed.angle)) < 0.3);
    if (group.length < MIN_STRIPES) continue;
    const left = Math.min(...group.map(part => part.minX));
    const right = Math.max(...group.map(part => part.maxX));
    const top = Math.min(...group.map(part => part.minY));
    const bottom = Math.max(...group.map(part => part.maxY));
    const area = (right - left + 1) * (bottom - top + 1) / (width * height);
    if (area < MIN_AREA) continue;
    let brightSum = 0, brightCount = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const value = luminance[y * width + x];
        if (value >= 0.25) { brightSum += value; brightCount++; }
      }
    }
    const light = brightSum / Math.max(1, brightCount);
    if (light >= MIN_LIGHT && (!best || area > best.area)) {
      best = { area, stripes: group.length, light };
    }
  }
  return best;
}

export function analyzePattern(luminance, sourceWidth, sourceHeight, width, height) {
  if (!width || !height || sourceWidth * sourceHeight !== luminance.length) return null;
  const source = sampleLuminance(luminance, sourceWidth, sourceHeight, width, height);
  let min = Infinity, max = -Infinity;
  for (const value of source) { min = Math.min(min, value); max = Math.max(max, value); }
  if (max - min < 0.25) return null;
  const normalized = new Float64Array(source.length);
  for (let i = 0; i < source.length; i++) normalized[i] = (source[i] - min) / (max - min);
  const real = Float64Array.from(normalized);
  const imaginary = new Float64Array(real.length);
  fft2d(real, imaginary, width, height);
  const scale = real.length;
  const magnitude = new Float64Array(scale);
  let smallest = Infinity, largest = -Infinity;
  for (let i = 0; i < scale; i++) {
    real[i] /= scale; imaginary[i] /= scale;
    magnitude[i] = Math.hypot(real[i], imaginary[i]);
    smallest = Math.min(smallest, magnitude[i]);
    largest = Math.max(largest, magnitude[i]);
  }
  if (largest <= smallest) return null;
  const spectrum = new Float64Array(scale);
  for (let i = 0; i < scale; i++) {
    const value = -1 + 2 * (magnitude[i] - smallest) / (largest - smallest);
    spectrum[i] = Math.log1p((1 - Math.abs(value)) ** 2);
  }
  const spectrumBytes = normalizeToBytes(spectrum);
  const threshold = otsu(spectrumBytes);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const centeredX = (x + width / 2) % width;
      const centeredY = (y + height / 2) % height;
      const nearCenter = (centeredX - width / 2) ** 2 + (centeredY - height / 2) ** 2 <= 25;
      if (spectrumBytes[index] > threshold && !nearCenter) {
        real[index] = 0;
        imaginary[index] = 0;
      }
    }
  }
  fft2d(real, imaginary, width, height, true);
  const mask = new Uint8Array(scale);
  let changed = 0;
  for (let i = 0; i < scale; i++) {
    if (Math.abs(Math.max(0, Math.min(255, Math.round(real[i] * 255))) - Math.round(normalized[i] * 255)) > 50) {
      mask[i] = 1;
      changed++;
    }
  }
  if (changed < scale * 0.1) return null;
  const parts = components(mask, width, height);
  const filteredRegion = groupedRegion(parts, source, width, height);
  if (filteredRegion) return filteredRegion;
  // Some strong periodic spectra reconstruct to a uniform difference mask.
  // IRIS's OpenCV contours are not available here, so use bright-region
  // components from the normalized source as a fallback for that case.
  const normalizedBytes = normalizeToBytes(normalized);
  const level = otsu(normalizedBytes);
  const brightMask = normalizedBytes.map(value => value > level ? 1 : 0);
  return groupedRegion(components(brightMask, width, height), source, width, height);
}

export class IrisPatternDetector {
  constructor(sourceWidth, sourceHeight) {
    const longest = Math.max(sourceWidth, sourceHeight);
    this.width = powerOfTwoAtMost(128 * sourceWidth / longest);
    this.height = powerOfTwoAtMost(128 * sourceHeight / longest);
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    this.runStart = null;
    this.alerted = false;
    this.activeAlert = null;
    this.alerts = [];
  }

  addFrame(time, frame) {
    const region = analyzePattern(frame.luminance, this.sourceWidth, this.sourceHeight,
      this.width, this.height);
    if (!region) {
      this.runStart = null;
      this.alerted = false;
      this.activeAlert = null;
      return;
    }
    if (this.runStart === null) this.runStart = time;
    if (!this.alerted && time - this.runStart >= HOLD_SECONDS) {
      this.activeAlert = { time, end: time, kind: 'Spatial pattern', level: 'pattern', area: region.area };
      this.alerts.push(this.activeAlert);
      this.alerted = true;
    }
    if (this.activeAlert) this.activeAlert.end = time + 1 / 15;
  }
}
