# Frameguard

A browser-only prototype that scans a **local video file before playback** and warns before sections with repeated brightness or saturated red changes. Video frames stay on the device. No build step, server-side processing, or external library is needed.

## Run

```sh
npm start
```

Open `http://localhost:8000`, choose a video, and click **Scan video**. The page keeps the video hidden while scanning. Afterward, flagged intervals appear under the player. Playback pauses behind an opaque warning at each interval; you can skip it or continue.

Run the analyzer tests with `npm test`.

## Flashing test fixture

`fixtures/POTENTIAL_SEIZURE_TRIGGER_DO_NOT_PLAY.webm` is a **potentially hazardous** four-second fixture: one second of static gray, two seconds of full-frame black/white flashing at five cycles per second, then one second of static gray. Do not preview or play it directly. Select it in Frameguard and scan it before considering playback.

With FFmpeg installed, `npm run verify-fixture` decodes the video without displaying it and asserts that the analyzer reports a rapid brightness alert. This verifies the analysis path on decoded frames, not the browser's seeking or playback guard. No video can be guaranteed to cause a seizure in a particular person.

## IRIS port status

`analyzer.js` ports the flash mechanics from [EA IRIS](https://github.com/electronicarts/IRIS):

- sRGB to linear RGB lookup and relative luminance;
- saturated-red coefficient `max(0, (R − G − B) × 320)` when `R / (R + G + B) ≥ 0.8`;
- a 25% changing-area gate and accumulated frame-average changes;
- warning at four transitions per second, rapid-flash alert above six transitions per second, and an extended alert when four to six transitions persist for four seconds of a five-second window.

IRIS's spatial-pattern detection is **not ported yet**. Its pattern implementation uses OpenCV Fourier transforms and contour analysis; it needs a separate browser implementation and test fixtures. See [IRIS attribution and license](THIRD_PARTY_LICENSES.md).

## Accuracy limits

This uses the browser's decoder and seeks through the file at up to 60 samples per second, analyzing frames scaled to at most 480 pixels on the longest side. IRIS normally analyzes decoded frames through OpenCV/FFmpeg, so browser seeking may skip source frames or sample the same frame twice. A clear scan does **not** mean the video is safe: fast or brief flashes, spatial patterns, HDR content, and decoder or scaling differences may affect results. This prototype has not been validated against IRIS's output or tested for WCAG conformance. IRIS itself does not guarantee or certify safety.

The scan can be slow for long videos because it decodes each sample before playback.

## Browser scope

This first version handles files the user selects locally. A normal web page cannot reliably inspect arbitrary videos on other sites: reading their pixels from a canvas is blocked when the video comes from a different origin without CORS permission. Supporting websites would require a separate browser-extension design with site-specific access and still may not work on protected streams.
