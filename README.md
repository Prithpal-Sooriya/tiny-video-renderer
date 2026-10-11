# tiny-video-renderer

**A video renderer small enough to embed in an agent skill: one file, zero npm dependencies.**

Write scenes as TypeScript that drives the DOM with Web Animations. `vw.ts` steps a virtual clock one frame at a time in Chrome, pipes the frames to ffmpeg, and writes a deterministic MP4. It needs Node (22.18+), a Chrome you already have, and ffmpeg. Nothing to install.

It is a cut-down [videowright](https://github.com/scosman/videowright) 0.1.1 (MIT): same segment API, same time shim, but ~1,000 lines of its own plus the shim instead of ~6,650 lines and 95 npm packages. On five projects compared frame by frame against upstream, four were **bit-identical** (video and audio) and one differed in a single frame by at most 3/255 in 46 pixels. Built for agents: no preview UI, failures are loud.

## Watch the walkthrough

A 2m26s tour: what this is, how to use it, and how to restyle it. Rendered by this repo's own `vw.ts` with the bundled `motion-engineering` style.

https://github.com/user-attachments/assets/1746c7da-147e-4827-a02a-0feed2ad7d03

The same file is committed at [`docs/walkthrough.mp4`](docs/walkthrough.mp4) if you want it offline. Narration and captions are AI-generated with local Kokoro TTS; every visual is rendered from this repo.

## Add it to your skill (instructions for agents)

1. Download the pinned file and verify it. Do not use `main` or a different version without reading the diff.

   ```bash
   mkdir -p render
   curl -fsSL https://raw.githubusercontent.com/Prithpal-Sooriya/tiny-video-renderer/v0.2.1/vw.ts -o render/vw.ts
   echo "2f5312719634a0c9b55af66ba23d02e35d54ba8da9340b99cb829147211c175c  render/vw.ts" | (sha256sum -c - 2>/dev/null || shasum -a 256 -c -)
   ```

2. Append this to the skill's `SKILL.md` (adjust the `render/` path if you put the file elsewhere):

   ````markdown
   ## Rendering video

   Render with `render/vw.ts` (one file, no npm install; needs Node 22.18+, Chrome and ffmpeg):

       node render/vw.ts render <timeline.ts> --dry-run                    # validate first, about a second
       node render/vw.ts render <timeline.ts> --fps 6 --output preview.mp4 # cheap layout check
       node render/vw.ts render <timeline.ts> --output out.mp4

   Project: a folder with `videowright.config.ts`, a `timeline.ts`, and `segments/<id>/index.ts`.
   See https://github.com/Prithpal-Sooriya/tiny-video-renderer/tree/main/example for a complete one.

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
node vw.ts render example/timeline.ts --output hello.mp4   # other styles: change the import in example/timeline.ts
```

Exit code 0 on success; on failure `Error: ...` and usually `Hint: ...`, exit 1. Throughput is about 15 frames per second at 1080p.
Chrome is found via `--chrome`, `$CHROME_BIN`, Playwright's cached `chrome-headless-shell`, then system Chrome. Its sandbox stays on; if it cannot start (inside another sandbox or a container) the renderer retries without it and says so.

A project's `timeline.ts` default-exports `{ meta: { title }, segments: [{ id, transition?: "fade" | "cut" | { type: "fade", duration } }], default_audio_track? }`. The audio track is `{ audio_file, length_s, timing: { perSegment } }` (path relative to the timeline); its timing overrides each segment's `advances`. `videowright.config.ts` sets `defaults: { resolution, fps }` (default 1920x1080 at 60). CSS imports are injected as `<style>`; images, fonts and audio are served from the project.

## Styles

The renderer has no built-in look. A style is one self-contained CSS file that your timeline imports (`import "./styles/motion-engineering/style.css";`); swapping styles is changing that line. Each lives in its own folder under [example/styles](example/styles) with a `style.css`, a `STYLE.md` (when to use it, rules for agents) and a `preview.mp4` rendered from the example:

| Style | Look | Preview |
|---|---|---|
| `midnight` | dark navy, orange accent, system sans | [preview.mp4](example/styles/midnight/preview.mp4) |
| `paper` | warm off-white, serif titles, blue accent | [preview.mp4](example/styles/paper/preview.mp4) |
| `motion-engineering` (default) | aerospace HUD: blueprint grid, corner ticks, Space Grotesk + JetBrains Mono (embedded) | [preview.mp4](example/styles/motion-engineering/preview.mp4) |

To use one, copy its folder into your project (the server only serves files inside the project) and import its `style.css`. To make your own, style the contract classes the segments use, and nothing else, so any style can replace any other. The `tvr-` prefix keeps these from colliding with class names in your own segments; tokens, fonts and the page background are global:

| Class | Role |
|---|---|
| `.tvr-stage` | full-frame container: layout and padding |
| `.tvr-line` | one animated-in row; must start at `opacity: 0` because segments animate it in |
| `.tvr-title`, `.tvr-subtitle` | the big heading and its second line |
| `.tvr-accent` | highlight colour |

Fonts: use system fonts, or embed them in `style.css` as `@font-face` data URLs (as `motion-engineering` does, so rendering needs no network). The renderer waits for fonts before each screenshot. `motion-engineering` is adapted from [videowright](https://github.com/scosman/videowright)'s style of the same name (MIT); its fonts are SIL OFL.

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
