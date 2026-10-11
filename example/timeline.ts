import "./styles/midnight/style.css";
import type { Timeline } from "videowright";

const timeline: Timeline = {
	meta: { title: "hello" },
	segments: [{ id: "title" }, { id: "steps", transition: "fade" }],
};

export default timeline;
