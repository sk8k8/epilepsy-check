# Frameguard

A browser-only prototype that scans a **local video file before playback** and warns before sections with rapid flashes or persistent spatial patterns. Video frames stay on the device. No build step or server-side processing is needed. The interface uses [Bulma 1.0.4](https://bulma.io/) from a pinned CDN URL, so the page needs internet access to load its styling.

## Run

```sh
npm start
```

Open `http://localhost:8000`, choose a video, and click **Scan video**. The page keeps the video hidden while scanning. Afterward, flagged intervals appear under the player. Playback pauses behind an opaque warning at each interval; you can skip it or continue.

Run the analyzer tests with `npm test`.

## Flashing test fixture

`fixtures/POTENTIAL_SEIZURE_TRIGGER_DO_NOT_PLAY.webm` is a **potentially hazardous** four-second fixture: one second of static gray, two seconds of full-frame black/white flashing at five cycles per second, then one second of static gray. Do not preview or play it directly. Select it in Frameguard and scan it before considering playback.

With FFmpeg installed, `npm run verify-fixture` decodes the video without displaying it and asserts that the analyzer reports a rapid brightness alert. This verifies the analysis path on decoded frames, not the browser's frame callbacks or playback guard. No video can be guaranteed to cause a seizure in a particular person.

For all supported detection paths, select `fixtures/POTENTIAL_TRIGGER_ALL_FEATURES_DO_NOT_PLAY.webm` in Frameguard. **Do not preview or play it directly.** The 24-second file has four separated sections:

| Time | Expected finding |
| --- | --- |
| 1–3 s | Rapid brightness flashing |
| 6–8 s | Rapid saturated-red flashing |
| 12–17 s | Extended lower-rate brightness flashing |
| 21–23 s | Persistent vertical spatial pattern |

The gaps are static gray so the scanner should show four separate warning intervals. `npm run verify-all-features-fixture` decodes the file without displaying it and checks every expected finding and interval. `npm run generate-all-features-fixture` rebuilds it with FFmpeg. The browser's scan and warning controls still need interactive validation; do not use direct playback as the test method.

## IRIS port status

`analyzer.js` ports flash mechanics from [EA IRIS](https://github.com/electronicarts/IRIS):

- sRGB to linear RGB lookup and relative luminance;
- saturated-red coefficient `max(0, (R − G − B) × 320)` when `R / (R + G + B) ≥ 0.8`;
- a 25% changing-area gate and accumulated frame-average changes;
- warning at four transitions per second, rapid-flash alert above six transitions per second, and an extended alert when four to six transitions persist for four seconds of a five-second window.

`pattern.js` adapts IRIS's spatial-pattern pipeline: frequency-domain filtering and inverse reconstruction, repeated-region grouping, a 25% area threshold, at least six stripe components, and half-second persistence. It processes sampled frames at 15 frames per second with a maximum 128-pixel transform dimension. OpenCV's exact contour and shape-matching behavior is approximated in JavaScript. Synthetic vertical, horizontal, and diagonal stripe cases are covered by `pattern.test.js`. See [IRIS attribution and license](THIRD_PARTY_LICENSES.md).

## Accuracy limits

For VP8/VP9 WebM files, the page reads encoded frames from the local file and decodes them with WebCodecs. This path checks that the decoder produced a frame for every encoded video block before showing results. It can run faster than real time. Other formats use muted, hidden playback and analyze the frame callbacks the browser delivers. If that path reports skipped frames, the page rejects the scan as incomplete instead of showing a misleading result. Frames are scaled down to at most 256 pixels on the longest side without upscaling. A clear scan does **not** mean the video is safe: fine or moving patterns, HDR content, unsupported WebM layouts, and decoder or scaling differences may affect results. This prototype has not been validated against IRIS's output or tested for WCAG conformance. IRIS itself does not guarantee or certify safety.

Keep the tab active during scanning. WebM direct decoding requires WebCodecs; other formats require `requestVideoFrameCallback`. Browsers may throttle media processing in background tabs.

## Browser scope

This first version handles files the user selects locally. A normal web page cannot reliably inspect arbitrary videos on other sites: reading their pixels from a canvas is blocked when the video comes from a different origin without CORS permission. Supporting websites would require a separate browser-extension design with site-specific access and still may not work on protected streams.
