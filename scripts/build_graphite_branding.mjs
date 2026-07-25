// Builds a substitute `branding/` asset pack for the Graphite web build.
//
// Graphite's own icon/logo pack ("graphite-branded-assets") is proprietary:
// it may only ship inside unmodified official builds, and derivative works
// "must substitute these branded assets before distribution". So none of it is
// downloaded or redistributed here. Instead every icon Graphite imports is
// filled from Pixelarticons (MIT), the same icon family ClackOS itself uses,
// with hand-drawn pixel glyphs for the ones Pixelarticons doesn't cover.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

const [, , graphiteDir, pixelDir] = process.argv;
const OUT = path.join(graphiteDir, "branding", "assets");

// --- glyphs drawn here, for icons Pixelarticons has no equivalent of --------
// All are 24x24 to match Pixelarticons, on the same 1px pixel grid.
const custom = {
	blank: "",
	dot: '<path d="M11 11h2v2h-2z"/>',
	"dot-thick": '<path d="M10 10h4v4h-4z"/>',
	pause: '<path d="M7 5h4v14H7zm6 0h4v14h-4z"/>',
	"to-start": '<path d="M5 5h2v14H5zm14 0v14l-12-7z"/>',
	"to-end": '<path d="M17 5h2v14h-2zM5 5v14l12-7z"/>',
	"ellipsis-vertical": '<path d="M11 4h2v2h-2zm0 7h2v2h-2zm0 7h2v2h-2z"/>',
	"fullscreen-enter": '<path d="M3 3h8v2H5v6H3zm10 0h8v8h-2V5h-6zM3 13h2v6h6v2H3zm16 0h2v8h-8v-2h6z"/>',
	"fullscreen-exit": '<path d="M9 3h2v8H3V9h6zm4 0h2v6h6v2h-8zM3 13h8v8H9v-6H3zm10 0h8v2h-6v6h-2z"/>',
	"window-maximize": '<path d="M3 4h18v16H3zm2 2v12h14V6z"/>',
	"window-minimize": '<path d="M4 11h16v2H4z"/>',
	"window-restore": '<path d="M7 3h14v14h-4v-2h2V5H9v2H7zM3 7h12v14H3zm2 2v10h8V9z"/>',
	"stroke-cap-butt": '<path d="M4 9h16v6H4zm2 2v2h12v-2z"/>',
	"stroke-cap-square": '<path d="M2 9h20v6H2z"/>',
	"stroke-cap-round": '<path d="M7 9h10v6H7zM5 10h2v4H5zm12 0h2v4h-2z"/>',
	"stroke-join-miter": '<path d="M4 4h16v16h-4V8H4z"/>',
	"stroke-join-round": '<path d="M4 4h10v4H8v12H4zm10 0h6v16h-4V8h-2z"/>',
	"stroke-join-bevel": '<path d="M4 4h12l4 4v12h-4V8H4z"/>',
	"align-inside": '<path d="M3 3h18v18H3zm2 2v14h14V5zm2 2h10v10H7z"/>',
	"align-center": '<path d="M5 5h14v14H5zm2 2v10h10V7z"/>',
	"align-outside": '<path d="M3 3h18v18H3zm4 4v10h10V7z"/>',
	"turn-negative": '<path d="M12 3v4a5 5 0 1 1-5 5H3a9 9 0 1 0 9-9zM8 3h4v4H8z"/>',
	"turn-positive": '<path d="M12 3v4a5 5 0 1 0 5 5h4a9 9 0 1 1-9-9zm4 0h-4v4h4z"/>',
	tilt: '<path d="M3 19h18v2H3zM6 17 16 3l2 2L8 19z"/>',
	"tilt-reset": '<path d="M3 19h18v2H3zM11 3h2v14h-2z"/>',
	"working-colors": '<path d="M3 3h12v12H3zm2 2v8h8V5zM9 9h12v12H9zm2 2v8h8v-8z"/>',
	"working-primary": '<path d="M3 3h12v12H3z"/><path d="M9 9h12v12H9zm2 2v8h8v-8z"/>',
	"working-secondary": '<path d="M9 9h12v12H9z"/><path d="M3 3h12v12H3zm2 2v8h8V5z"/>',
	"small-dot": '<path d="M10 10h4v4h-4z"/>',
	"reverse-gradient-left": '<path d="M3 6h18v12H3zm2 2v8h14V8z"/><path d="M6 9h3v6H6zm5 0h2v6h-2zm4 0h1v6h-1z"/>',
	"reverse-gradient-right": '<path d="M3 6h18v12H3zm2 2v8h14V8z"/><path d="M18 9h-3v6h3zm-5 0h-2v6h2zm-4 0H8v6h1z"/>',
	"spine-away": '<path d="M11 3h2v18h-2zM3 6h6v2H3zm12 0h6v2h-6zM3 16h6v2H3zm12 0h6v2h-6z"/>',
	"spine-towards": '<path d="M11 3h2v18h-2zM5 6h6v2H5zm8 0h6v2h-6zM5 16h6v2H5zm8 0h6v2h-6z"/>',
	"zoom-1x": '<path d="M4 4h16v16H4zm2 2v12h12V6zm4 2h2v8h-2zm-2 0h2v2H8z"/>',
	"zoom-2x": '<path d="M4 4h16v16H4zm2 2v12h12V6zm3 2h6v4h-4v2h4v2H9v-4h4V10H9z"/>',
	"handle-all": '<path d="M4 11h4v2H4zm12 0h4v2h-4zM9 4h6v2H9zm0 14h6v2H9zM10 10h4v4h-4z"/>',
	"handle-frontier": '<path d="M4 11h4v2H4zm6-1h4v4h-4z"/>',
	"handle-selected": '<path d="M10 10h4v4h-4zm-6 1h4v2H4z"/>',
	overlays: '<path d="M3 3h12v12H3zm2 2v8h8V5z"/><path d="M9 9h12v12H9zm2 2v8h8v-8z"/>',
	snapping: '<path d="M11 3h2v6h-2zm0 12h2v6h-2zM3 11h6v2H3zm12 0h6v2h-6zm-5-1h4v4h-4z"/>',
	"grid-dotted": '<path d="M4 4h2v2H4zm7 0h2v2h-2zm7 0h2v2h-2zM4 11h2v2H4zm7 0h2v2h-2zm7 0h2v2h-2zM4 18h2v2H4zm7 0h2v2h-2zm7 0h2v2h-2z"/>',
	"boolean-union": '<path d="M3 3h12v6h6v12H9v-6H3zm2 2v8h6v-2h2v2h6v6h-2v-6h-2v6H5V5z" /><path d="M3 3h12v12H3zm6 6h12v12H9z" fill-opacity=".35"/>',
	"boolean-subtract-front": '<path d="M3 3h12v12H3zm2 2v8h8V5z"/><path d="M9 9h12v12H9zm2 2v8h8v-8z" fill-opacity=".35"/>',
	"boolean-subtract-back": '<path d="M9 9h12v12H9zm2 2v8h8v-8z"/><path d="M3 3h12v12H3zm2 2v8h8V5z" fill-opacity=".35"/>',
	"boolean-intersect": '<path d="M9 9h6v6H9z"/><path d="M3 3h12v12H3zm2 2v8h8V5zm4 4h12v12H9zm2 2v8h8v-8z" fill-opacity=".35"/>',
	"boolean-difference": '<path d="M3 3h12v12H3zm2 2v8h8V5zm4 4h12v12H9zm2 2v8h8v-8z"/>',
	"boolean-divide": '<path d="M3 3h12v12H3zm2 2v8h8V5zm4 4h12v12H9zm2 2v8h8v-8zM9 9h6v6H9z"/>',
	"stack-order-above": '<path d="M3 3h18v6H3zm2 2v2h14V5zM3 13h18v8H3zm2 2v4h14v-4z"/>',
	"stack-order-below": '<path d="M3 3h18v8H3zm2 2v4h14V5zM3 15h18v6H3zm2 2v2h14v-2z"/>',
};

// --- name mapping ----------------------------------------------------------
// value: "pixel:<name>" for a Pixelarticons file, "custom:<name>" for above.
const map = {
	"icon-12px-solid": {
		add: "pixel:plus",
		checkmark: "pixel:check",
		clipped: "pixel:scissors",
		"close-x": "pixel:close",
		delay: "pixel:clock",
		"dot-thick": "custom:dot-thick",
		dot: "custom:dot",
		"dropdown-arrow": "pixel:chevron-down",
		"edit-12px": "pixel:pencil",
		"empty-12px": "custom:blank",
		failure: "pixel:close",
		"fullscreen-enter": "custom:fullscreen-enter",
		"fullscreen-exit": "custom:fullscreen-exit",
		"grid-dotted": "custom:grid-dotted",
		grid: "pixel:grid-3x3",
		info: "pixel:info-box",
		"keyboard-arrow-down": "pixel:chevron-down",
		"keyboard-arrow-left": "pixel:chevron-left",
		"keyboard-arrow-right": "pixel:chevron-right",
		"keyboard-arrow-up": "pixel:chevron-up",
		"keyboard-backspace": "pixel:delete",
		"keyboard-command": "pixel:square",
		"keyboard-control": "pixel:chevron-up",
		"keyboard-enter": "pixel:corner-down-left",
		"keyboard-option": "pixel:sort-horizontal",
		"keyboard-shift": "pixel:arrow-big-up",
		"keyboard-space": "pixel:minus",
		"keyboard-tab": "pixel:tab",
		"license-12px": "pixel:script",
		link: "pixel:link",
		overlays: "custom:overlays",
		remove: "pixel:minus",
		"render-mode-normal": "pixel:image",
		"render-mode-outline": "pixel:frame",
		"render-mode-pixels": "pixel:grid-3x3",
		"render-mode-svg": "pixel:braces",
		snapping: "custom:snapping",
		"swap-horizontal": "pixel:arrows-horizontal",
		"swap-vertical": "pixel:arrows-vertical",
		"vertical-ellipsis": "custom:ellipsis-vertical",
		warning: "pixel:square-alert",
		"window-button-win-close": "pixel:close",
		"window-button-win-maximize": "custom:window-maximize",
		"window-button-win-minimize": "custom:window-minimize",
		"window-button-win-restore-down": "custom:window-restore",
		"working-colors": "custom:working-colors",
	},
	"icon-16px-solid": {
		"align-bottom": "pixel:align-end-vertical",
		"align-top": "pixel:align-start-vertical",
		"align-left": "pixel:align-start-horizontal",
		"align-right": "pixel:align-end-horizontal",
		"align-horizontal-center": "pixel:align-center-horizontal",
		"align-vertical-center": "pixel:align-center-vertical",
		artboard: "pixel:frame",
		"boolean-difference": "custom:boolean-difference",
		"boolean-divide": "custom:boolean-divide",
		"boolean-intersect": "custom:boolean-intersect",
		"boolean-subtract-back": "custom:boolean-subtract-back",
		"boolean-subtract-front": "custom:boolean-subtract-front",
		"boolean-union": "custom:boolean-union",
		bug: "pixel:bug",
		"checkbox-checked": "pixel:checkbox-on",
		"checkbox-unchecked": "pixel:checkbox",
		"close-all": "pixel:copy-x",
		close: "pixel:close",
		code: "pixel:braces",
		copy: "pixel:copy",
		credits: "pixel:heart",
		"custom-color": "pixel:colors-swatch",
		cut: "pixel:scissors",
		"deselect-all": "pixel:square-dashed-cursor",
		edit: "pixel:pencil",
		empty: "custom:blank",
		"expand-fill-stroke": "pixel:expand",
		"eye-hidden": "pixel:eye-off",
		"eye-hide": "pixel:eye-off",
		"eye-show": "pixel:ai-view",
		"eye-visible": "pixel:ai-view",
		eyedropper: "pixel:pipette",
		"file-export": "pixel:upload",
		"file-import": "pixel:download",
		file: "pixel:file",
		"flip-horizontal": "pixel:flip-horizontal-2",
		"flip-vertical": "pixel:flip-vertical-2",
		"folder-open": "pixel:open",
		folder: "pixel:folder",
		"frame-all": "pixel:frame",
		"frame-selected": "pixel:square-dashed-cursor",
		"graph-view-closed": "pixel:tournament",
		"graph-view-open": "pixel:algorithm",
		// Deliberately not the Graphite logo: ClackOS substitutes its own mark.
		"graphite-logo": "pixel:leaf",
		"handle-visibility-all": "custom:handle-all",
		"handle-visibility-frontier": "custom:handle-frontier",
		"handle-visibility-selected": "custom:handle-selected",
		heart: "pixel:heart",
		"history-redo": "pixel:redo",
		"history-undo": "pixel:undo",
		"icons-grid": "pixel:icons",
		image: "pixel:image",
		"interpolation-blend": "pixel:invert",
		"interpolation-morph": "pixel:shapes",
		layer: "pixel:files",
		license: "pixel:script",
		"new-layer": "pixel:plus-box",
		"node-blur": "pixel:spray-wave",
		"node-brushwork": "pixel:brush",
		"node-color-correction": "pixel:invert",
		"node-gradient": "pixel:spray-image",
		"node-magic-wand": "pixel:sparkle",
		"node-mask": "pixel:square-dashed-cursor",
		"node-motion-blur": "pixel:speed-fast",
		"node-nodes": "pixel:algorithm",
		"node-output": "pixel:goal",
		"node-shape": "pixel:shapes",
		"node-text": "pixel:text-start-t",
		"node-transform": "pixel:scale",
		node: "pixel:circle",
		"padlock-locked": "pixel:lock",
		"padlock-unlocked": "pixel:unlock",
		paste: "pixel:clipboard",
		"pin-active": "pixel:map-pin",
		"pin-inactive": "pixel:map-pin-home",
		"playback-pause": "custom:pause",
		"playback-play": "pixel:play",
		"playback-to-end": "custom:to-end",
		"playback-to-start": "custom:to-start",
		random: "pixel:shuffle",
		reload: "pixel:reload",
		reset: "pixel:undo",
		resync: "pixel:repeat",
		"reverse-radial-gradient-to-left": "custom:reverse-gradient-left",
		"reverse-radial-gradient-to-right": "custom:reverse-gradient-right",
		reverse: "pixel:sort-vertical",
		save: "pixel:save",
		"select-all": "pixel:square-cursor",
		"select-parent": "pixel:corner-up-left",
		settings: "pixel:settings-cog",
		"small-dot": "custom:small-dot",
		"stack-bottom": "pixel:align-end-vertical",
		"stack-hollow": "pixel:section-copy",
		"stack-lower": "pixel:arrow-down",
		"stack-raise": "pixel:arrow-up",
		"stack-reverse": "pixel:sort-vertical",
		stack: "pixel:files",
		"stroke-align-center": "custom:align-center",
		"stroke-align-inside": "custom:align-inside",
		"stroke-align-outside": "custom:align-outside",
		"stroke-cap-butt": "custom:stroke-cap-butt",
		"stroke-cap-round": "custom:stroke-cap-round",
		"stroke-cap-square": "custom:stroke-cap-square",
		"stroke-join-bevel": "custom:stroke-join-bevel",
		"stroke-join-miter": "custom:stroke-join-miter",
		"stroke-join-round": "custom:stroke-join-round",
		"stroke-order-above": "custom:stack-order-above",
		"stroke-order-below": "custom:stack-order-below",
		"text-align-center": "pixel:text-align-center",
		"text-align-left": "pixel:text-align-left",
		"text-align-right": "pixel:text-align-right",
		"text-align-spine-away": "custom:spine-away",
		"text-align-spine-towards": "custom:spine-towards",
		"text-justify-all": "pixel:text-align-justify",
		"text-justify-center": "pixel:text-align-center-box",
		"text-justify-left": "pixel:text-align-left-box",
		"text-justify-right": "pixel:text-align-right-box",
		"tilt-reset": "custom:tilt-reset",
		tilt: "custom:tilt",
		"transformation-grab": "pixel:hand",
		"transformation-rotate": "pixel:reload",
		"transformation-scale": "pixel:scale",
		trash: "pixel:trash",
		"turn-negative-90": "custom:turn-negative",
		"turn-positive-90": "custom:turn-positive",
		"user-manual": "pixel:book-open",
		"viewport-design-mode": "pixel:shapes",
		"viewport-guide-mode": "pixel:radius",
		"viewport-select-mode": "pixel:pointer",
		volunteer: "pixel:users",
		website: "pixel:globe",
		"working-colors-primary": "custom:working-primary",
		"working-colors-secondary": "custom:working-secondary",
		"zoom-1x": "custom:zoom-1x",
		"zoom-2x": "custom:zoom-2x",
		"zoom-in": "pixel:zoom-in",
		"zoom-out": "pixel:zoom-out",
		"zoom-reset": "pixel:search",
	},
	"icon-24px-two-tone": {
		"general-artboard-tool": "pixel:frame",
		"general-eyedropper-tool": "pixel:pipette",
		"general-fill-tool": "pixel:spray-can",
		"general-gradient-tool": "pixel:spray-image",
		"general-navigate-tool": "pixel:hand",
		"general-select-tool": "pixel:pointer",
		"raster-brush-tool": "pixel:brush",
		"raster-clone-tool": "pixel:copy",
		"raster-detail-tool": "pixel:pencil",
		"raster-heal-tool": "pixel:magic-edit",
		"raster-patch-tool": "pixel:section-copy",
		"raster-relight-tool": "pixel:lightbulb",
		"vector-ellipse-tool": "pixel:circle",
		"vector-freehand-tool": "pixel:pencil",
		"vector-line-tool": "pixel:minus",
		"vector-path-tool": "pixel:spline-cursor",
		"vector-pen-tool": "pixel:feather",
		"vector-polygon-tool": "pixel:shapes",
		"vector-rectangle-tool": "pixel:square",
		"vector-spline-tool": "pixel:tangent",
		"vector-text-tool": "pixel:text-start-t",
	},
};

// Mouse hint icons are drawn here: a mouse body with the relevant button lit.
function mouseHint(name) {
	const body = '<path d="M8 2h8v3H8zM6 5h12v15H6zm2 2v11h8V7z" fill-opacity=".55"/>';
	const buttons = {
		lmb: '<path d="M8 7h3v5H8z"/>',
		rmb: '<path d="M13 7h3v5h-3z"/>',
		mmb: '<path d="M11 7h2v5h-2z"/>',
		none: "",
	};
	const key = ["lmb", "rmb", "mmb"].find((b) => name.includes(b)) || "none";
	let extra = "";
	// A double-click gets two ticks above the mouse, a drag gets a motion arrow.
	if (name.includes("double")) extra = '<path d="M9 0h2v3H9zm4 0h2v3h-2z"/>';
	else if (name.includes("drag") || name === "mouse-hint-drag") extra = '<path d="M18 11h4v2h-4zm3-2 3 3-3 3z"/>';
	else if (name.includes("scroll-up")) extra = '<path d="M11 9h2v-3l3 0-4-4-4 4 3 0z"/>';
	else if (name.includes("scroll-down")) extra = '<path d="M11 6h2v3l3 0-4 4-4-4 3 0z"/>';
	return body + (buttons[key] || "") + extra;
}

const wrap = (inner, size) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="currentColor" viewBox="0 0 24 24">${inner}</svg>\n`;

function pixelInner(name) {
	const file = path.join(pixelDir, `${name}.svg`);
	if (!existsSync(file)) throw new Error(`Pixelarticons has no icon "${name}"`);
	const svg = readFileSync(file, "utf8");
	const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>[\s\S]*$/, "");
	return inner.trim();
}

let written = 0;
for (const [dir, entries] of Object.entries(map)) {
	const size = Number(/(\d+)px/.exec(dir)[1]);
	mkdirSync(path.join(OUT, dir), { recursive: true });
	for (const [icon, source] of Object.entries(entries)) {
		const [kind, key] = source.split(":");
		const inner = kind === "pixel" ? pixelInner(key) : custom[key];
		if (inner === undefined) throw new Error(`No custom glyph "${key}" for ${dir}/${icon}`);
		writeFileSync(path.join(OUT, dir, `${icon}.svg`), wrap(inner, size));
		written += 1;
	}
}

mkdirSync(path.join(OUT, "icon-16px-two-tone"), { recursive: true });
for (const name of [
	"mouse-hint-drag",
	"mouse-hint-lmb-double",
	"mouse-hint-lmb-drag",
	"mouse-hint-lmb",
	"mouse-hint-mmb-drag",
	"mouse-hint-mmb",
	"mouse-hint-none",
	"mouse-hint-rmb-double",
	"mouse-hint-rmb-drag",
	"mouse-hint-rmb",
	"mouse-hint-scroll-down",
	"mouse-hint-scroll-up",
]) {
	writeFileSync(path.join(OUT, "icon-16px-two-tone", `${name}.svg`), wrap(mouseHint(name), 16));
	written += 1;
}

// The logotype in the title bar: plain monospace text, not a lookalike wordmark.
mkdirSync(path.join(OUT, "graphics"), { recursive: true });
writeFileSync(
	path.join(OUT, "graphics", "graphite-logotype-solid.svg"),
	'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="24" viewBox="0 0 120 24">' +
		'<text x="0" y="17" fill="currentColor" font-family="\'IBM Plex Mono\', monospace" font-size="16" letter-spacing="0.5">Graphite</text>' +
		"</svg>\n",
);
written += 1;

// Empty icon sets the build also globs over, plus the marker `cargo run` checks
// so it never tries to download the proprietary pack over the top of this one.
writeFileSync(path.join(graphiteDir, "branding", ".branding"), readFileSync(path.join(graphiteDir, ".branding")));

// Cross-check against every branding path the frontend actually imports, so an
// upstream bump that adds an icon fails here rather than shipping a blank.
function sources(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
		return /\.(ts|svelte)$/.test(entry.name) ? [full] : [];
	});
}
const needed = new Set(
	sources(path.join(graphiteDir, "frontend", "src")).flatMap((file) =>
		[...readFileSync(file, "utf8").matchAll(/\/\.\.\/branding\/([^"']+)/g)].map((m) => m[1]),
	),
);
const missing = [...needed].filter((relative) => !existsSync(path.join(graphiteDir, "branding", relative)));
console.log(`Wrote ${written} substitute assets for ${needed.size} imports; ${missing.length} missing`);
missing.forEach((m) => console.log("  missing:", m));
if (missing.length) process.exitCode = 1;
