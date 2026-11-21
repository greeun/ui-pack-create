#!/usr/bin/env node
// Compares, by computed style, how many of the values collected from the source pages (ledger.json from site-collect.mjs) are present in the pack's gallery.
//
// Usage: node site-fidelity.mjs <pack dir> <collection dir> [--min 0.7]
// The reference is the gallery area (#gallery) of the pack viewer (<pack>/view/index.html). Build it first with build-view.py.
//
// Only values that repeat in the source are checked (used 3 or more times, or found on 2 or more pages). A value seen once is not a rule.
// For each family (text color, surface color, font size, radius, ...) it prints the share of source values that are also in the pack gallery (weighted by use count),
// and lists the source values missing from the pack, most used first. Add a missing value to the pack, or write why it is left out in section 9 of the design guide.
// When the pack is an inspired pack (origin.mode in pack.json is "inspired"), the brand colors listed in origin.brand (colors within a 30° hue angle) and the proprietary fonts
// are changed on purpose, so they are left out of the share and listed separately. If such a value is still in the pack, that is a failure. Other chromatic colors, such as status colors, are compared as usual.
// If the share of any family is below --min, the exit code is 1.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browser, chromatic, collectExpr, hueGap, oklch, rgbClose } from "./cdp.mjs";

const args = process.argv.slice(2);
const mi = args.indexOf("--min");
const min = mi >= 0 ? Number(args.splice(mi, 2)[1]) : 0.7;
const [packDir, srcDir] = args;
if (!packDir || !srcDir) { console.error("Usage: node site-fidelity.mjs <pack dir> <collection dir> [--min 0.7]"); process.exit(2); }
const view = path.resolve(packDir, "view", "index.html");
if (!fs.existsSync(view)) { console.error(`No pack viewer: ${view} (build it first with scripts/build-view.py of the ui-pack skill)`); process.exit(2); }
const meta = JSON.parse(fs.readFileSync(path.join(packDir, "pack.json"), "utf8"));
const inspired = meta.origin?.mode === "inspired";
const src = JSON.parse(fs.readFileSync(path.join(srcDir, "ledger.json"), "utf8"));

const COLOR = new Set(["text color", "surface color", "border color"]);
const num = (v) => parseFloat(v);
const close = (family, a, b) => {
  if (COLOR.has(family)) return rgbClose(a, b);
  if (family === "font") { const n = (v) => v.toLowerCase().replace(/variable|var|\s|-/g, ""); return n(a).includes(n(b)) || n(b).includes(n(a)); }
  if (family === "font weight" || family === "shadow" || a === "pill" || b === "pill") return a === b;
  if (family === "transition") return a.split(" ")[0] === b.split(" ")[0];
  if (family === "letter spacing") return Math.abs(num(a) - num(b)) <= 0.004;
  return Math.abs(num(a) - num(b)) <= 0.5;
};

const brandColors = (meta.origin?.brand?.colors || []).map((c) => (c.length === 4 ? "#" + [...c.slice(1)].map((x) => x + x).join("") : c));
const brandFonts = meta.origin?.brand?.fonts || [];
const b = await browser();
let low = 0, kept = 0;
try {
  // When the source does not follow the color scheme (pinned theme), compare only with the pack gallery theme that matches the lightness of the source background.
  const fixed = src.followsColorScheme ? null : (oklch(Object.entries(src.ledger.light["surface color"]).sort((x, y) => y[1].count - x[1].count)[0][0]).l < 0.5 ? "dark" : "light");
  if (fixed) console.log(`The source is pinned to the ${fixed} theme. Comparing that theme only.`);
  for (const scheme of ["light", "dark"]) {
    if (fixed && scheme !== fixed) continue;
    const want = src.ledger[fixed ? "light" : scheme];
    if (!want) continue;
    const page = await b.open(pathToFileURL(view).href, { scheme, wait: 3000 });
    await page.evaluate(`(() => { try { localStorage.clear(); } catch {} document.documentElement.removeAttribute("data-theme"); return true; })()`);
    const got = await page.evaluate(collectExpr("#gallery"));
    await page.close();
    if (!got) { console.error("The pack viewer has no #gallery"); process.exit(2); }
    console.log(`\n== ${scheme === "light" ? "light theme" : "dark theme"}`);
    for (const [family, values] of Object.entries(want)) {
      const have = Object.keys(got.families[family] || {});
      let total = 0, hit = 0;
      const missing = [], changed = [];
      for (const [value, e] of Object.entries(values)) {
        if (e.count < 3 && e.pages.length < 2) continue;
        const found = have.some((h) => close(family, value, h));
        const isBrand = family === "font" ? brandFonts.some((f) => close("font", value, f))
          : COLOR.has(family) && chromatic(value) && brandColors.some((c) => hueGap(value, c) < 30);
        if (inspired && isBrand) { changed.push(`${value}${found ? " (still in the pack: must be changed)" : ""}`); if (found) kept++; continue; }
        total += e.count;
        if (found) hit += e.count; else missing.push([value, e.count]);
      }
      if (!total && !changed.length) continue;
      const rate = total ? hit / total : 1;
      if (rate < min) low++;
      console.log(`${rate < min ? "low " : "    "}  ${family}: ${(rate * 100).toFixed(0)}%  (${have.length} values in the pack gallery)`);
      missing.sort((x, y) => y[1] - x[1]).slice(0, 6).forEach(([v, c]) => console.log(`        source only: ${v}  (${c}x)`));
      if (changed.length) console.log(`        left out of the comparison as source brand colors or proprietary fonts: ${changed.slice(0, 6).join(", ")}`);
    }
  }
} finally {
  await b.close();
}
console.log(`\n${low} families below ${min * 100}%${inspired ? `, ${kept} source brand colors or proprietary fonts still in the pack` : ""}`);
process.exitCode = low || kept ? 1 : 0;
