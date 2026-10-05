# Frameguard

A browser-only prototype that scans a **local video file before playback** and warns before sections with repeated brightness or saturated red changes. Video frames stay on the device. No build step, server-side processing, or external library is needed.

## Run

```sh
npm start
```

Open `http://localhost:8000`, choose a video, and click **Scan video**. The page keeps the video hidden while scanning. Afterward, flagged intervals appear under the player. Playback pauses behind an opaque warning at each interval; you can skip it or continue.

Run the analyzer tests with `npm test`.

## What the scanner checks

The scanner seeks through the browser-decoded video at up to 30 samples per second and analyzes downscaled 160 × 90 frames. It looks for changes in relative luminance over at least 20% of sampled pixels, or saturated-red pixels appearing and disappearing over that area. Four opposing transition pairs within a rolling second flag an interval. This is a screening heuristic informed by [WCAG 2.2's flash definitions](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold) and [EA IRIS](https://github.com/electronicarts/IRIS); it is **not** an IRIS port or a WCAG compliance test.

A clear scan does **not** mean a video is safe. Sampling can miss brief or high-frequency flashes, small regions, moving patterns, and spatial patterns. The red check uses a simplified RGB screen rather than WCAG's CIE chromaticity calculation. A browser's decoder, seeking precision, and supported formats also affect results. The scan can be slow for long videos because it decodes each sample before playback.

## Browser scope

This first version handles files the user selects locally. A normal web page cannot reliably inspect arbitrary videos on other sites: reading their pixels from a canvas is blocked when the video comes from a different origin without CORS permission. Supporting websites would require a separate browser-extension design with site-specific access and still may not work on protected streams.
