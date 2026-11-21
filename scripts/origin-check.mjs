#!/usr/bin/env node
// Checks the origin record (origin in pack.json) of a pack made without source code (from-site.md). Exit code 0 when it passes.
//
// Usage: node origin-check.mjs <pack dir>
//
// origin format:
//   "origin": {
//     "mode": "faithful" | "inspired",          // faithful pack | inspired pack
//     "inputs": [{ "kind": "url" | "sns-post" | "image" | "video", "ref": "<URL or file name>", "captured": "2026-11-21" }],
//     "rights": "<what the user said about owning it or having permission, and the date>",   // required for faithful
//     "credit": "<original author, account or site name>",                                   // required for inspired
//     "brand": {                                // what is unique to the source. Must not remain in an inspired pack
//       "terms": ["product, company or site name", ...],
//       "colors": ["#5e6ad2", ...],             // brand colors of the source (accent color, logo color). Empty array plus colorsNote when the source is achromatic only
//       "fonts": ["commercial or proprietary font name", ...]
//     },
//     "estimated": ["font", "motion duration", ...]  // what was estimated instead of measured (required for image and video input)
//   }
//
// Checks:
//   all       required fields; the pack name does not contain brand.terms
//   inspired  brand.terms and brand.fonts appear nowhere in the pack files (view/ excluded),
//             the chromatic colors of the pack gallery are 30° or more of hue angle away from brand.colors (read as computed colors in the pack viewer)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browser, chromatic, collectExpr, hueGap } from "./cdp.mjs";

const packDir = process.argv[2];
if (!packDir) { console.error("Usage: node origin-check.mjs <pack dir>"); process.exit(2); }
const meta = JSON.parse(fs.readFileSync(path.join(packDir, "pack.json"), "utf8"));
const o = meta.origin;
const bad = [];
const need = (cond, msg) => { if (!cond) bad.push(msg); };

need(o, "pack.json has no origin");
if (o) {
  need(["faithful", "inspired"].includes(o.mode), 'origin.mode must be "faithful" or "inspired"');
  need(Array.isArray(o.inputs) && o.inputs.length && o.inputs.every((i) => ["url", "sns-post", "image", "video"].includes(i.kind) && i.ref && i.captured), "origin.inputs needs kind, ref and captured");
  need(o.brand && Array.isArray(o.brand.terms) && Array.isArray(o.brand.colors) && Array.isArray(o.brand.fonts), "origin.brand needs the arrays terms, colors and fonts (empty arrays when there are none)");
  if (o.mode === "faithful") need(o.rights, "a faithful pack needs origin.rights (what the user said about owning it or having permission). Without it, make an inspired pack");
  if (o.mode === "inspired") {
    need(o.credit, "an inspired pack needs origin.credit (original author or site)");
    need(o.brand?.terms?.length, "an inspired pack needs at least one product or site name of the source in origin.brand.terms");
    need(o.brand?.colors?.length || o.brand?.colorsNote, "an inspired pack needs the brand colors of the source in origin.brand.colors (when the source is achromatic only, say so in colorsNote)");
  }
  if ((o.inputs || []).some((i) => i.kind !== "url")) need(Array.isArray(o.estimated) && o.estimated.length, "image and video input needs the estimated items in origin.estimated");
}
const terms = (o?.brand?.terms || []).filter((t) => t.length >= 3);
for (const t of terms) need(!meta.name.toLowerCase().includes(t.toLowerCase()), `the pack name contains the source name "${t}"`);

if (o?.mode === "inspired" && o.brand) {
  // Source names and proprietary fonts inside files. The origin in pack.json itself and the pack viewer are excluded.
  const words = [...terms, ...o.brand.fonts];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "view" || e.name === "node_modules" ? [] : walk(p);
    return /\.(tsx?|css|md|json|mts|mjs|txt)$/.test(e.name) || dir.endsWith("fonts") ? [p] : [];
  });
  for (const f of walk(packDir)) {
    const rel = path.relative(packDir, f);
    for (const w of words) if (rel.toLowerCase().includes(w.toLowerCase().replace(/\s+/g, ""))) bad.push(`file name contains "${w}": ${rel}`);
    if (!/\.(tsx?|css|md|json|mts|mjs|txt)$/.test(f)) continue;
    let text = fs.readFileSync(f, "utf8");
    if (rel === "pack.json") { const m = JSON.parse(text); delete m.origin; text = JSON.stringify(m); }
    const lines = text.split("\n");
    for (const w of words) {
      // Match only the exact spelling as a separate word ("Linear" does not match linear-gradient or ease-linear)
      const re = new RegExp("(?<![A-Za-z0-9_-])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_-])");
      const i = lines.findIndex((l) => re.test(l));
      if (i >= 0) bad.push(`"${w}" remains: ${rel}:${i + 1}`);
    }
  }
  // Hue angle between the chromatic colors of the gallery and the source brand colors
  const view = path.resolve(packDir, "view", "index.html");
  if (!fs.existsSync(view)) bad.push(`could not check colors, no pack viewer: ${view} (build it first with scripts/build-view.py of the ui-pack skill)`);
  else if (o.brand.colors.length) {
    const b = await browser();
    try {
      const seen = new Set();
      for (const scheme of ["light", "dark"]) {
        const page = await b.open(pathToFileURL(view).href, { scheme, wait: 3000 });
        const got = await page.evaluate(collectExpr("#gallery"));
        await page.close();
        for (const fam of ["text color", "surface color", "border color"]) for (const c of Object.keys(got?.families?.[fam] || {})) seen.add(c);
      }
      for (const c of [...seen].filter(chromatic)) {
        for (const brand of o.brand.colors) {
          const gap = hueGap(c, brand.length === 4 ? "#" + [...brand.slice(1)].map((x) => x + x).join("") : brand);
          if (gap < 30) bad.push(`gallery color ${c} is ${gap.toFixed(0)}° of hue angle from the source brand color ${brand} (keep it 30° or more away)`);
        }
      }
    } finally {
      await b.close();
    }
  }
}

if (bad.length) {
  console.log(`Origin check: ${bad.length} problems`);
  [...new Set(bad)].forEach((m) => console.log("  - " + m));
  process.exit(1);
}
console.log(`Origin check: passed (${o.mode === "inspired" ? "inspired pack" : "faithful pack"}, inputs ${o.inputs.map((i) => i.kind).join(", ")})`);
