# Mockup Vid

A browser-only tool for putting mobile UI screen recordings inside a phone mockup and exporting the result as a video.

## Use

Open `index.html` in Chrome, Edge or Safari. There's no build step. To serve it locally instead, run:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

1. **Screen recording**: drop in a video (MP4/MOV/WebM) or a screenshot. Choose *Fill* (crop to the screen) or *Fit*.
2. **Background**: pick a solid color (color picker, hex code or swatches), or upload a photo with optional blur and dim.
3. **Phone**: set the frame finish (natural titanium, black, white, blue), the size and the shadow.
4. **Export**: pick the canvas size (1:1, 4:5, 9:16, 16:9, 4K square), the format (MP4 or WebM, whichever your browser supports) and the frame rate, then click **Export video**. To save a still, use **Save PNG frame**.

Export records in real time with `MediaRecorder`, so a 20-second clip takes about 20 seconds. Keep the tab visible while it runs.

Everything runs locally in your browser. Nothing is uploaded.

## Video formats

MP4 (H.264), MOV and WebM play directly. If the browser can't decode a file, for example an HEVC/H.265 `.MOV` from an iPhone in Chrome, the app converts it to H.264 MP4 on your device with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm). The wrapper is in `vendor/`. The roughly 32 MB core loads from jsDelivr the first time a conversion is needed.
