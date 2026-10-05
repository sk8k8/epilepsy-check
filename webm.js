// Minimal EBML/WebM demuxer for ordinary non-laced VP8/VP9 video blocks.
// Unsupported layouts throw so a partial scan cannot be reported as complete.
const ID = {
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  CODEC_ID: 0x86,
  VIDEO: 0xe0,
  PIXEL_WIDTH: 0xb0,
  PIXEL_HEIGHT: 0xba,
  CLUSTER: 0x1f43b675,
  TIMESTAMP: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  REFERENCE_BLOCK: 0xfb,
};

function vintWidth(first) {
  if (!first) throw new Error('Invalid EBML variable-length integer.');
  let width = 1, bit = 0x80;
  while (!(first & bit)) { width++; bit >>= 1; }
  return width;
}
function readVint(bytes, offset, removeMarker) {
  if (offset >= bytes.length) throw new Error('Truncated WebM file.');
  const width = vintWidth(bytes[offset]);
  if (width > 8 || offset + width > bytes.length) throw new Error('Invalid WebM element size.');
  let value = removeMarker ? bytes[offset] & (0xff >> width) : bytes[offset];
  for (let i = 1; i < width; i++) value = value * 256 + bytes[offset + i];
  const unknown = removeMarker && value === 2 ** (7 * width) - 1;
  return { width, value, unknown };
}
function* elements(bytes, start, end) {
  let offset = start;
  while (offset < end) {
    const id = readVint(bytes, offset, false);
    const size = readVint(bytes, offset + id.width, true);
    const dataStart = offset + id.width + size.width;
    const dataEnd = size.unknown ? end : dataStart + size.value;
    if (dataEnd > end || dataEnd <= offset) throw new Error('Invalid WebM element bounds.');
    yield { id: id.value, start: dataStart, end: dataEnd };
    offset = dataEnd;
  }
}
function unsigned(bytes, start, end) {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  return value;
}
function text(bytes, start, end) {
  return new TextDecoder().decode(bytes.subarray(start, end));
}
function parseVideo(bytes, start, end) {
  const info = { width: 0, height: 0 };
  for (const element of elements(bytes, start, end)) {
    if (element.id === ID.PIXEL_WIDTH) info.width = unsigned(bytes, element.start, element.end);
    if (element.id === ID.PIXEL_HEIGHT) info.height = unsigned(bytes, element.start, element.end);
  }
  return info;
}
function parseTrack(bytes, start, end) {
  const track = { number: 0, type: 0, codecId: '', width: 0, height: 0 };
  for (const element of elements(bytes, start, end)) {
    if (element.id === ID.TRACK_NUMBER) track.number = unsigned(bytes, element.start, element.end);
    if (element.id === ID.TRACK_TYPE) track.type = unsigned(bytes, element.start, element.end);
    if (element.id === ID.CODEC_ID) track.codecId = text(bytes, element.start, element.end);
    if (element.id === ID.VIDEO) Object.assign(track, parseVideo(bytes, element.start, element.end));
  }
  return track;
}
function parseBlock(bytes, element, timestamp, scale, videoTrack, keyOverride) {
  const trackNumber = readVint(bytes, element.start, true);
  let offset = element.start + trackNumber.width;
  if (offset + 3 > element.end) throw new Error('Truncated WebM block.');
  const relative = (bytes[offset] << 8) | bytes[offset + 1];
  const signedRelative = relative >= 0x8000 ? relative - 0x10000 : relative;
  const flags = bytes[offset + 2];
  offset += 3;
  if (trackNumber.value !== videoTrack) return null;
  if (flags & 0x06) throw new Error('Laced WebM video blocks are not supported.');
  const microseconds = Math.round((timestamp + signedRelative) * scale / 1000);
  if (microseconds < 0) throw new Error('Invalid WebM frame timestamp.');
  return {
    timestamp: microseconds,
    type: keyOverride ?? ((flags & 0x80) ? 'key' : 'delta'),
    data: bytes.subarray(offset, element.end),
  };
}

export function demuxWebM(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let segment = null;
  for (const element of elements(bytes, 0, bytes.length)) {
    if (element.id === ID.SEGMENT) { segment = element; break; }
  }
  if (!segment) throw new Error('No WebM segment found.');
  let scale = 1_000_000;
  let videoTrack = null;
  let clusterElements = [];
  for (const element of elements(bytes, segment.start, segment.end)) {
    if (element.id === ID.INFO) {
      for (const child of elements(bytes, element.start, element.end)) {
        if (child.id === ID.TIMESTAMP_SCALE) scale = unsigned(bytes, child.start, child.end);
      }
    } else if (element.id === ID.TRACKS) {
      for (const child of elements(bytes, element.start, element.end)) {
        if (child.id !== ID.TRACK_ENTRY) continue;
        const track = parseTrack(bytes, child.start, child.end);
        if (track.type === 1 && !videoTrack) videoTrack = track;
      }
    } else if (element.id === ID.CLUSTER) {
      clusterElements.push(element);
    }
  }
  if (!videoTrack || !videoTrack.number) throw new Error('No supported WebM video track found.');
  if (!['V_VP8', 'V_VP9'].includes(videoTrack.codecId)) {
    throw new Error(`Unsupported WebM codec: ${videoTrack.codecId}`);
  }
  const frames = [];
  for (const cluster of clusterElements) {
    let timestamp = 0;
    for (const element of elements(bytes, cluster.start, cluster.end)) {
      if (element.id === ID.TIMESTAMP) timestamp = unsigned(bytes, element.start, element.end);
      else if (element.id === ID.SIMPLE_BLOCK) {
        const frame = parseBlock(bytes, element, timestamp, scale, videoTrack.number);
        if (frame) frames.push(frame);
      } else if (element.id === ID.BLOCK_GROUP) {
        let block = null, referenced = false;
        for (const child of elements(bytes, element.start, element.end)) {
          if (child.id === ID.BLOCK) block = child;
          if (child.id === ID.REFERENCE_BLOCK) referenced = true;
        }
        if (block) {
          const frame = parseBlock(bytes, block, timestamp, scale, videoTrack.number,
            referenced ? 'delta' : 'key');
          if (frame) frames.push(frame);
        }
      }
    }
  }
  if (!frames.length) throw new Error('No decodable WebM video frames found.');
  return { ...videoTrack, frames };
}
