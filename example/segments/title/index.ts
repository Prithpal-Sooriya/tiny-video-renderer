import { defineSegment } from "videowright";

let host: HTMLElement; // keep the segment's own element: during a transition the previous segment is still in the DOM

export default defineSegment({
	id: "title",
	advances: [3], // no beats, so just the segment's length: 3 seconds
	mount(el) {
		host = el;
		el.innerHTML = `<div class="tvr-stage"><div class="tvr-line tvr-title">tiny-video-renderer</div><div class="tvr-line tvr-subtitle">TypeScript + Web Animations <span class="tvr-accent">→</span> MP4</div></div>`;
	},
	async play(ctx) {
		host.querySelectorAll(".tvr-line").forEach((l, i) => l.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: i * 400, fill: "forwards" }));
		await ctx.hold(3000);
	},
});
