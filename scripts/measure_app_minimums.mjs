// Measures the smallest window each app fits in, for the `minWidth` and
// `minHeight` of its entry in content/applications/menu.json.
//
// An app shown smaller than its layout needs either scrolls its whole page or
// cuts something off, and the window manager cannot tell which apps mind: a
// paint program scales to anything, a MIDI console with four columns of panels
// does not. So each app is opened on a real desktop, its window squeezed, and
// the app's document inspected for the two ways it can fail:
//
//   - the page itself scrolls (the document, its body, or for an integrated
//     app the window body around its shadow root);
//   - something sticks out past the edge that clips it, or a short scrolling
//     strip (a toolbar, a menu bar) has run out of room sideways;
//   - something is squashed instead: an editor, list or page view collapsed
//     below 100px, a label spilling out of its button, or two neighbouring
//     blocks piled on top of each other.
//
// Panels that scroll by design are left alone: a long settings sidebar, a
// track list or a CodeMirror editor scrolling is the app working, not failing,
// as long as it keeps enough room to be worked in.
//
// Narrowing a responsive app makes it taller, as it wraps and finally stacks
// into one column, so the two minimums cannot be found independently. The
// width reported is the narrowest at which nothing overflows at the app's
// default height, and the height is what the app needs at that width. A
// window can then be any size at or above both without scrolling, and its
// default size is always one of them. A default size that does not fit is
// reported too, with the height it needs.
//
// Serve the site, then run:
//
//   python3 -m http.server 8000
//   node scripts/measure_app_minimums.mjs [page-substring,…]
//
// Needs Playwright with a Chromium (`npm i -g playwright` or similar; nothing
// is added to the repo). The output is advice, not a rewrite of menu.json:
// round the numbers up a little, and where an app trades width for height
// steeply, pick the width just above its stacking point by eye.

import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.CLACKOS_URL || "http://localhost:8000/";
const menu = JSON.parse(readFileSync(path.join(ROOT, "content/applications/menu.json"), "utf8"));
const only = process.argv[2] ? process.argv[2].split(",") : null;

const apps = [];
(function walk(items) {
	for (const item of items) {
		if (item.type === "app") apps.push(item);
		if (item.items) walk(item.items);
	}
})(menu.items);

/* Runs in the desktop page. With W and H it sets the app window's body to that
 * size; without, it reports how far the app overflows at its current size. */
function probe(title, W, H) {
	const el = [...document.querySelectorAll("section.window")].find(w => w.getAttribute("aria-label") === title);
	if (!el) return { error: "no window" };
	const body = el.querySelector(".winbody");
	if (W != null) {
		el.style.minWidth = "0"; el.style.minHeight = "0";
		el.style.left = "8px"; el.style.top = "8px";
		const fw = el.offsetWidth - body.clientWidth, fh = el.offsetHeight - body.clientHeight;
		el.style.width = (W + fw) + "px"; el.style.height = (H + fh) + "px";
		return { fw, fh };
	}
	const frame = body.querySelector("iframe");
	let doc, root, vp, scrollers;
	if (frame) {
		doc = frame.contentDocument;
		if (!doc) return { error: "cross-origin" };
		root = doc;
		vp = { right: frame.clientWidth, bottom: frame.clientHeight };
		scrollers = [doc.documentElement, doc.body];
	} else {
		root = body.querySelector(".integrated-app-host").shadowRoot; doc = document;
		const r = body.getBoundingClientRect();
		vp = { right: r.left + body.clientWidth, bottom: r.top + body.clientHeight };
		scrollers = [body];
	}
	const win = doc.defaultView;
	const name = e => e.tagName + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.split(" ")[0] : "");
	let x = 0, y = 0, culprit = "";
	const note = (axis, amount, e) => {
		if (axis === "x" && amount > x) { x = amount; culprit = name(e); }
		if (axis === "y" && amount > y) { y = amount; culprit = name(e); }
	};
	for (const s of scrollers) {
		if (!s) continue;
		note("x", s.scrollWidth - s.clientWidth, s);
		note("y", s.scrollHeight - s.clientHeight, s);
	}
	const skipTags = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "TEMPLATE", "OPTION", "HEAD"]);
	for (const e of root.querySelectorAll("*")) {
		if (skipTags.has(e.tagName)) continue;
		const r = e.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) continue;
		const cs = win.getComputedStyle(e);
		if (cs.visibility === "hidden" || cs.position === "fixed" || cs.opacity === "0") continue;
		if (e.closest("dialog:not([open]), [hidden], .modal, .paint-modal, .clack-fm-modal")) continue;
		if (e.offsetParent === null && !["BODY", "HTML"].includes(e.tagName) && !(e instanceof win.SVGElement)) continue;
		/* an editor, list or page view squeezed to a sliver still "fits" */
		const scrolls = /auto|scroll/.test(cs.overflowX + cs.overflowY) || e.matches("textarea, .CodeMirror");
		if (scrolls && !e.matches("select, input") && !e.closest(".rm-dd, .rm-bar, nav")
			&& (e.scrollHeight > e.clientHeight + 2 || e.matches("textarea, .CodeMirror"))) {
			if (e.clientWidth < 100) note("x", 100 - e.clientWidth, e);
			else if (e.clientHeight < 100) note("y", 100 - e.clientHeight, e);
		}
		/* CodeMirror's insides overhang its edges by design */
		if (e.closest(".CodeMirror") && !e.matches(".CodeMirror")) continue;
		/* a label wider than the button it is printed on */
		if (!e.children.length && e.clientWidth > 0 && cs.overflowX === "visible" && cs.whiteSpace !== "normal"
			&& /\S/.test(e.textContent) && !e.closest(".rm-dd"))
			note("x", e.scrollWidth - e.clientWidth, e);
		/* neighbouring blocks squeezed on top of one another */
		const next = e.nextElementSibling;
		if (next && cs.position !== "absolute" && /^(block|flex|grid|flow-root|inline-block|inline-flex)$/.test(cs.display)) {
			const ncs = win.getComputedStyle(next), nr = next.getBoundingClientRect();
			if (ncs.display === cs.display && !/absolute|fixed/.test(ncs.position) && nr.width > 2 && nr.height > 2) {
				const ix = Math.min(r.right, nr.right) - Math.max(r.left, nr.left);
				const iy = Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top);
				if (ix > 4 && iy > 4) note("y", Math.min(ix, iy), e);
			}
		}
		/* a toolbar that scrolls sideways has run out of room */
		if (/auto|scroll/.test(cs.overflowX) && e.clientHeight < 90 && !e.matches("textarea, input, pre, code, .rm-dd"))
			note("x", e.scrollWidth - e.clientWidth, e);
		let a = e.parentElement || e.parentNode?.host, clip = null, scrolled = false;
		while (a && a !== doc.documentElement && a !== doc.body && !a.classList?.contains("winbody")) {
			const acs = win.getComputedStyle(a);
			if (/auto|scroll/.test(acs.overflowX + acs.overflowY) || acs.position === "fixed") { scrolled = true; break; }
			if (/hidden|clip/.test(acs.overflowX + acs.overflowY)) { clip = a; break; }
			a = a.parentElement || a.parentNode?.host;
		}
		if (scrolled) continue;
		const box = clip ? clip.getBoundingClientRect() : vp;
		note("x", r.right - box.right, e);
		note("y", r.bottom - box.bottom, e);
	}
	return { x: Math.round(x), y: Math.round(y), culprit };
}

const browser = await chromium.launch();
for (const app of apps) {
	if (only && !only.some(o => app.page.includes(o))) continue;
	const title = app.title || app.label;
	const page = await browser.newPage({ viewport: { width: 2000, height: 1400 } });
	try {
		await page.goto(new URL(`?open=app:applications/${app.page}`, BASE).href, { waitUntil: "load", timeout: 60000 });
		await page.waitForTimeout(5000);
		await page.evaluate(t => document.querySelectorAll("section.window").forEach(w => {
			if (w.getAttribute("aria-label") !== t) w.style.display = "none";
		}), title);
		await page.evaluate(src => { window.__probe = (0, eval)("(" + src + ")"); }, probe.toString());
		const at = async (W, H) => {
			await page.evaluate(([t, W, H]) => window.__probe(t, W, H), [title, W, H]);
			await page.waitForTimeout(250);
			return page.evaluate(t => window.__probe(t), title);
		};
		const frame = await page.evaluate(([t]) => window.__probe(t, 1000, 700), [title]);
		const T = 2, CAP = 1300;
		const fitsX = r => r.x <= T, fitsY = r => r.y <= T;
		/* the least height the app fits in at body width W, or Infinity */
		const heightAt = async W => {
			if (!fitsY(await at(W, CAP))) return Infinity;
			let lo = 80, hi = CAP;
			while (hi - lo > 3) { const mid = (lo + hi) >> 1; if (fitsY(await at(W, mid))) hi = mid; else lo = mid; }
			return hi;
		};
		const defW = (app.width || 770) - frame.fw, defH = (app.height || 800) - frame.fh;
		const defaultFitsX = fitsX(await at(defW, CAP));
		const needH = await heightAt(defW);
		const target = Math.max(defH, needH === Infinity ? CAP : needH);
		const floorW = 320 - frame.fw;
		let lo = 120, hi = Math.max(defW, floorW);
		const fits = r => fitsX(r) && fitsY(r);
		if (!fits(await at(hi, target))) hi = 1850;
		while (hi - lo > 3) { const mid = (lo + hi) >> 1; if (fits(await at(mid, target))) hi = mid; else lo = mid; }
		const minW = app.fixed ? hi : Math.max(hi, floorW);
		const minH = await heightAt(minW);
		const report = {
			minWidth: minW + frame.fw,
			minHeight: minH + frame.fh,
			current: [app.minWidth ?? null, app.minHeight ?? null],
			default: [defW + frame.fw, defH + frame.fh]
		};
		if (!defaultFitsX) report.defaultTooNarrow = true;
		if (needH > defH) report.defaultNeedsHeight = needH + frame.fh;
		if (app.fixed) report.fixed = true;
		console.log(app.page.padEnd(28), JSON.stringify(report));
	} catch (error) {
		console.log(app.page.padEnd(28), "failed:", String(error).split("\n")[0]);
	}
	await page.close();
}
await browser.close();
