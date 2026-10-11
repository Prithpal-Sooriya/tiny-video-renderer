# tiny-video-renderer

**A video renderer small enough to embed in an agent skill: one file, zero npm dependencies.**

Write scenes as TypeScript that drives the DOM with Web Animations. `vw.ts` steps a virtual clock one frame at a time in Chrome, pipes the frames to ffmpeg, and writes a deterministic MP4. It needs Node (22.18+), a Chrome you already have, and ffmpeg. Nothing to install.

It is a cut-down [videowright](https://github.com/scosman/videowright) 0.1.1 (MIT): same segment API, same time shim, but ~1,000 lines of its own plus the shim instead of ~6,650 lines and 95 npm packages. On five projects compared frame by frame against upstream, four were **bit-identical** (video and audio) and one differed in a single frame by at most 3/255 in 46 pixels. Built for agents: no preview UI, failures are loud.

## Add it to your skill (instructions for agents)

1. Download the pinned file and verify it. Do not use `main` or a different version without reading the diff.

   ```bash
   mkdir -p render
   curl -fsSL https://raw.githubusercontent.com/Prithpal-Sooriya/tiny-video-renderer/v0.1.1/vw.ts -o render/vw.ts
   echo "8ffd959ff999196f882cbec4f935376397ccde49446e871d0f9a00cfb5336e4f  render/vw.ts" | (sha256sum -c - 2>/dev/null || shasum -a 256 -c -)
   ```

2. Append this to the skill's `SKILL.md` (adjust the `render/` path if you put the file elsewhere):

   ````markdown
   ## Rendering video

   Render with `render/vw.ts` (one file, no npm install; needs Node 22.18+, Chrome and ffmpeg):

       node render/vw.ts render <timeline.ts> --dry-run                    # validate first, about a second
       node render/vw.ts render <timeline.ts> --fps 6 --output preview.mp4 # cheap layout check
       node render/vw.ts render <timeline.ts> --output out.mp4

   Project: a folder with `videowright.config.ts`, a `timeline.ts`, and `segments/<id>/index.ts`.
   See https://github.com/Prithpal-Sooriya/tiny-video-renderer/tree/v0.1.1/example for a complete one.

   Segment code rules:
   - Erasable TypeScript only: no enum, namespace, constructor parameter properties or decorators. Use `import type`.
   - Import only relative files or `"videowright"` (`defineSegment`, `defineConfig`, `fade`, `cut`). No npm packages.
   - Animate with Web Animations (`el.animate(..., { fill: "forwards" })`) and `ctx.hold(ms)` only. No CSS
     animations or transitions, no `iterations: Infinity`, no real timers or network.
   - Query the DOM through the element given to `mount(el)`, never `document`: during a transition the
     previous segment is still in the page.
   - `advances` are segment-relative seconds, strictly increasing. Each `await ctx.waitForNext()` consumes one;
     the last value is the segment's length. `advances: [3, 8]` pairs with one `waitForNext()`.
   - Treat every `Warning:` line as a bug. A segment that throws stops the render with its message.
   ````

3. Check it works: `node render/vw.ts render <your timeline.ts> --dry-run` prints the frame count.

## Use

```bash
node vw.ts render <timeline.ts> [--output out.mp4] [--fps N] [--chrome PATH] [--no-sandbox] [--dry-run] [--verbose]
node vw.ts render example/timeline.ts --output hello.mp4
```

Exit code 0 on success; on failure `Error: ...` and usually `Hint: ...`, exit 1. Throughput is about 15 frames per second at 1080p.
Chrome is found via `--chrome`, `$CHROME_BIN`, Playwright's cached `chrome-headless-shell`, then system Chrome. Its sandbox stays on; if it cannot start (inside another sandbox or a container) the renderer retries without it and says so.

A project's `timeline.ts` default-exports `{ meta: { title }, segments: [{ id, transition?: "fade" | "cut" | { type: "fade", duration } }], default_audio_track? }`. The audio track is `{ audio_file, length_s, timing: { perSegment } }` (path relative to the timeline); its timing overrides each segment's `advances`. `videowright.config.ts` sets `defaults: { resolution, fps }` (default 1920x1080 at 60). CSS imports are injected as `<style>`; images, fonts and audio are served from the project.

## How it works, and how it was checked

Everything above the `@@NODE_ONLY@@` marker in `vw.ts` is browser-safe: the server sends only that half to Chrome as the module `"videowright"`, and Node loads the same file under that name to read the project's config and timeline. The Node half has a loopback static server (Node strips the types per request), a small DevTools client in place of Playwright, and the frame loop. It serves one project on `127.0.0.1` for the length of a render, with a loopback `Host` check and no path traversal, and Chrome runs with a throwaway profile. No telemetry, no `eval`, no network needed.

| Project (rendered with upstream and with `vw.ts`, same Chrome) | Frames | Result |
|---|---|---|
| fades, SVG reveal | 266 | bit-identical video and audio |
| code blocks, clip-path reveal | 321 | bit-identical |
| diff blocks, SVG assemble | 321 | bit-identical |
| deep dive, 10 scenes, 9 fades | 663 | bit-identical |
| older HUD-style project | 565 | 564 identical; 1 fade-boundary frame differs in 46 px by at most 3/255 |

Three things mattered for matching upstream pixel for pixel: Playwright's per-platform generic font table, engaging virtual time inside the page, and waiting for `document.fonts.ready` before each screenshot. Tests: `node --test test.ts`.

**Limits:** verified on macOS with Node 24 only (Linux font tables are included but untested; Windows untested). One audio track, no preview player, no slide transitions. Tracks videowright 0.1.1; later upstream changes are not picked up.

## License

MIT. Contains MIT-licensed code from videowright (the time shim is verbatim) and configuration tables from Playwright (Apache-2.0); the notices are in the header of `vw.ts`.
