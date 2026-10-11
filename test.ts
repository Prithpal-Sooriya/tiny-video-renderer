// node --test test.ts   (the render tests skip themselves when Chrome or ffmpeg is missing)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildFfmpegArgs, buildFrameSchedule, findChrome, findFfmpeg, loadModule, resolveTiming, startServer, validateSegmentAdvances } from "./vw.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const VW = join(HERE, "vw.ts");
const canRender = [findChrome, findFfmpeg].every((f) => { try { return f(); } catch { return false; } });

/** A throwaway copy of ./example, optionally with files added or replaced. */
function project(files: Record<string, string> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "vw-test-"));
	cpSync(join(HERE, "example"), dir, { recursive: true });
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, name)), { recursive: true });
		writeFileSync(join(dir, name), text);
	}
	return dir;
}
const render = (...args: string[]) => spawnSync("node", [VW, "render", ...args], { encoding: "utf-8", timeout: 120000 });
const timeline = { segments: [{ id: "a" }, { id: "b" }] };

// ---- pure logic ----

test("frame schedule: beats land on rounded global frames and segments accumulate", () => {
	const s = buildFrameSchedule(timeline, { a: [1.0, 2.5], b: [1.0] }, 10);
	assert.deepEqual(s.map((x) => [x.globalFrame, x.segmentId, x.isLast]), [[10, "a", false], [25, "a", true], [35, "b", true]]);
});

test("the audio track's timing overrides segment advances", () => {
	const segs = [{ id: "a", advances: [1, 2] }, { id: "b", advances: [3] }];
	assert.deepEqual(resolveTiming(segs), { a: [1, 2], b: [3] });
	assert.deepEqual(resolveTiming(segs, { timing: { perSegment: { a: [5, 6] } } }), { a: [5, 6], b: [3] });
});

test("advances must be present, positive and strictly increasing", () => {
	assert.deepEqual(validateSegmentAdvances(timeline, { a: [1, 2], b: [1] }), []);
	const bad = validateSegmentAdvances(timeline, { a: [2, 1], b: [] }).join("\n");
	assert.match(bad, /strictly increasing/);
	assert.match(bad, /missing or empty/);
});

test("ffmpeg: audio is padded and clipped to the video length", () => {
	assert.ok(!buildFfmpegArgs(30, "o.mp4").includes("-shortest"));
	const a = buildFfmpegArgs(30, "o.mp4", "a.mp3");
	assert.ok(a.includes("apad") && a.includes("-shortest") && a.at(-1) === "o.mp4");
});

// ---- Node loader and server ----

test("loader: bare 'videowright', CSS imports and .js-for-.ts imports resolve", async () => {
	const dir = project({ "audio/track.ts": "export default { n: 1 };\n", "uses_js.ts": 'import t from "./audio/track.js";\nexport default t;\n' });
	assert.equal((await loadModule(join(dir, "videowright.config.ts"))).default.projectStructure, "v1");
	assert.deepEqual((await loadModule(join(dir, "timeline.ts"))).default.segments.map((s: any) => s.id), ["title", "steps"]); // imports ./styles/midnight/style.css
	assert.deepEqual((await loadModule(join(dir, "uses_js.ts"))).default, { n: 1 });
});

test("server: strips types, resolves extensionless, wraps CSS, guards paths, sends Chrome only the browser half", async () => {
	const outside = mkdtempSync(join(tmpdir(), "vw-outside-"));
	writeFileSync(join(outside, "shared.css"), "a{color:red}");
	const dir = project({ "segments/label.ts": "export function label(text: string): string { return text; }\n", "segments/bad.ts": "enum E { A }\nexport const e = E.A;\n" });
	symlinkSync(outside, join(dir, "linked")); // a symlink the project owner placed inside the project
	const server = await startServer(dir, join(dir, "timeline.ts"), 10);
	const get = (p: string) => fetch(server.url + p);
	try {
		assert.match(await (await get("/render.html")).text(), /"videowright":"\/__vw\/vw\.ts"/);
		assert.match(await (await get("/__vw/virtual.js")).text(), /"steps": \(\) => import\("\/c\/segments\/steps\/index\.ts"\)/);

		const browser = await (await get("/__vw/vw.ts")).text();
		assert.match(browser, /export function defineSegment/);
		assert.ok(!browser.includes("node:child_process") && !browser.includes("startServer"), "Chrome must not receive the Node half");

		assert.match(await (await get("/c/segments/label")).text(), /export function label\(text\s*\)\s*\{/); // extensionless; types become spaces
		assert.match(await (await get("/c/styles/midnight/style.css")).text(), /document\.head\.appendChild/);
		assert.equal((await get("/c/linked/shared.css")).status, 200, "in-project symlinks are followed");
		assert.equal((await get("/c/../../../etc/hosts")).status, 404, "dot-dot traversal is blocked");
		assert.equal((await get("/c/%2e%2e/%2e%2e/etc/hosts")).status, 404, "encoded traversal is blocked");
		const bad = await get("/c/segments/bad.ts");
		assert.equal(bad.status, 500);
		assert.match(await bad.text(), /enum/i);
		const foreign = await new Promise<number>((resolve, reject) => {
			const u = new URL(server.url); // fetch() ignores a custom Host header, so use node:http
			request({ host: u.hostname, port: u.port, path: "/render.html", headers: { Host: "evil.example:80" } }, (res) => (res.resume(), resolve(res.statusCode ?? 0))).on("error", reject).end();
		});
		assert.equal(foreign, 403, "foreign Host is refused");
	} finally {
		await server.close();
	}
});

// ---- real renders ----

test("render: dry run reports the frame count", { skip: !canRender }, () => {
	const r = render(join(HERE, "example", "timeline.ts"), "--dry-run");
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /total frames: 140 \(7\.0s\) at 1280x720 20fps/);
});

test("render: writes an mp4", { skip: !canRender }, () => {
	const out = join(mkdtempSync(join(tmpdir(), "vw-out-")), "o.mp4");
	const r = render(join(HERE, "example", "timeline.ts"), "--fps", "5", "--output", out);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Rendered 35 frames/);
	assert.ok(statSync(out).size > 1000 && readFileSync(out).subarray(4, 8).toString() === "ftyp");
});

test("render: a segment that throws fails the render with its message", { skip: !canRender }, () => {
	const dir = project({ "segments/steps/index.ts": readFileSync(join(HERE, "example/segments/steps/index.ts"), "utf-8").replace("let host", 'throw new Error("boom in play");\nlet host') });
	const r = render(join(dir, "timeline.ts"), "--dry-run");
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /boom in play/);
});

test("render: a missing segment is named in the error", { skip: !canRender }, () => {
	const dir = project({ "timeline.ts": readFileSync(join(HERE, "example/timeline.ts"), "utf-8").replace('{ id: "steps", transition: "fade" }', '{ id: "steps", transition: "fade" }, { id: "ghost" }') });
	const r = render(join(dir, "timeline.ts"), "--dry-run");
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Missing segment "ghost"/);
});

test("render: more advances than waitForNext() calls renders but warns", { skip: !canRender }, () => {
	const dir = project({ "segments/steps/index.ts": readFileSync(join(HERE, "example/segments/steps/index.ts"), "utf-8").replace("[1, 2.5, 4]", "[1, 2, 2.5, 4]") });
	const r = render(join(dir, "timeline.ts"), "--fps", "5", "--output", join(dir, "o.mp4"));
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Warning: segment "steps": a scheduled beat had no pending waitForNext/);
});

test("render: unsupported TypeScript syntax is explained", { skip: !canRender }, () => {
	const dir = project({ "segments/steps/index.ts": "enum E { A }\nexport default { id: 'steps', advances: [1], play: async () => {}, x: E.A };\n" });
	const r = render(join(dir, "timeline.ts"), "--dry-run");
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /enum/i);
});

test("every style has a folder with style.css, STYLE.md and the whole class contract", () => {
	const dir = join(HERE, "example", "styles");
	const styles = readdirSync(dir);
	assert.ok(styles.length >= 3);
	for (const s of styles) {
		for (const f of ["style.css", "STYLE.md"]) assert.ok(existsSync(join(dir, s, f)), `${s}/${f} is missing`);
		const css = readFileSync(join(dir, s, "style.css"), "utf-8");
		for (const cls of [".stage", ".line", ".title", ".subtitle", ".accent"]) assert.ok(css.includes(cls), `${s}/style.css is missing ${cls}`);
	}
});
