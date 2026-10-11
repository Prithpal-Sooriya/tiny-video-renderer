import { defineSegment } from "videowright";

let host: HTMLElement;

export default defineSegment({
	id: "steps",
	advances: [1, 2.5, 4], // two beats (two waitForNext calls) and a total length of 4 seconds
	mount(el) {
		host = el;
		el.innerHTML = `<div class="tvr-stage"><div class="tvr-line">1. your segments drive the DOM</div><div class="tvr-line">2. a virtual clock steps one frame at a time</div></div>`;
	},
	async play(ctx) {
		const [a, b] = Array.from(host.querySelectorAll(".tvr-line"));
		a.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: "forwards" });
		await ctx.waitForNext();
		b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: "forwards" });
		await ctx.waitForNext();
	},
});
