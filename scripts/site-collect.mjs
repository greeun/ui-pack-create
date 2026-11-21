#!/usr/bin/env node
// Collects the computed styles and screenshots of web pages (read-only). Used when making a pack from a URL (from-site.md).
//
// Usage: node site-collect.mjs --out <dir> [--attach <port>] [--light-attr name=value] [--dark-attr name=value] <url> [<url> ...]
//   --attach <port>  Attach to a Chrome the user logged in to themselves (--remote-debugging-port=<port>). For screens behind the login of the user's own site.
//   --light-attr, --dark-attr  When the site pins its theme with an html attribute (e.g. data-theme=dark): the attribute to set on html when collecting the light and dark theme.
//                    Example: --light-attr data-theme=light --dark-attr data-theme=dark  (give a class as "class=dark")
// Give up to three URLs of the same site, each a page with a different layout.
//
// Checks before collecting. If any check fails, nothing is collected and the script exits with code 3:
//   1. Services that forbid automated collection or show their content only after login (BLOCKED below)
//   2. robots.txt "User-agent: *" disallows the path
//   3. Opening the page redirects to a login screen (without --attach)
// In that case ask the user for screenshots and continue with the image input procedure. There is no option to skip the checks.
//
// Output: <dir>/<page>-<light|dark>-<width>.json and .png, <dir>/ledger.json (use count and page count per value)
import fs from "node:fs";
import path from "node:path";
import { browser, collectExpr, sleep } from "./cdp.mjs";

const BLOCKED = ["instagram.com", "tiktok.com", "facebook.com", "fb.com", "threads.net", "threads.com", "x.com", "twitter.com", "linkedin.com", "pinterest.com", "snapchat.com", "reddit.com", "youtube.com"];
const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = take("--out");
const attach = take("--attach");
const themeAttr = { light: take("--light-attr"), dark: take("--dark-attr") };
const urls = args;
if (!out || !urls.length || urls.length > 3) {
  console.error("Usage: node site-collect.mjs --out <dir> [--attach <port>] <url> [<url> ...]  (up to three URLs)");
  process.exit(2);
}
const stop = (msg) => { console.error(`Not collecting: ${msg}\n→ Ask the user for screenshots and continue with the image input procedure (from-site.md section 2, "Images and video").`); process.exit(3); };

// 1 and 2. Blocked services and robots.txt
const robots = new Map();
for (const u of urls) {
  const url = new URL(u);
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(url.hostname) || url.hostname.endsWith(".ts.net");
  if (BLOCKED.some((d) => url.hostname === d || url.hostname.endsWith("." + d))) stop(`${url.hostname} is a service that forbids automated collection`);
  if (local) continue;
  if (!robots.has(url.origin)) {
    let text = "";
    try { const r = await fetch(url.origin + "/robots.txt", { signal: AbortSignal.timeout(10000) }); if (r.ok) text = await r.text(); } catch {}
    const rules = [];
    let on = false, inAgents = false;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const [k, v] = [m[1].toLowerCase(), m[2].trim()];
      if (k === "user-agent") { on = inAgents ? on || v === "*" : v === "*"; inAgents = true; continue; }
      inAgents = false;
      if (on && (k === "disallow" || k === "allow") && v) rules.push({ allow: k === "allow", path: v });
    }
    robots.set(url.origin, rules);
  }
  const match = (rule) => new RegExp("^" + rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")).test(url.pathname + url.search);
  const hit = robots.get(url.origin).filter(match).sort((a, b) => b.path.length - a.path.length)[0];
  if (hit && !hit.allow) stop(`${url.origin}/robots.txt disallows ${url.pathname} (Disallow: ${hit.path})`);
}

fs.mkdirSync(out, { recursive: true });
const b = await browser({ attach: attach ? Number(attach) : undefined });
const ledger = {};
const pages = [];
try {
  for (const u of urls) {
    const slug = (new URL(u).pathname.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "home").slice(0, 40);
    for (const [scheme, width] of [["light", 1440], ["dark", 1440], ["light", 390]]) {
      const page = await b.open(u, { width, height: width === 390 ? 844 : 1000, scheme, wait: 6000 });
      if (themeAttr[scheme]) {
        const [k, v] = themeAttr[scheme].split("=");
        await page.evaluate(`(() => { document.documentElement.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v ?? "")}); return true; })()`);
        await sleep(1000);
      }
      const data = await page.evaluate(collectExpr(null));
      // 3. Did the page redirect to a login screen?
      const landed = new URL(data.url);
      if (!attach && landed.pathname !== new URL(u).pathname && /log-?in|sign-?in|accounts|auth/i.test(landed.pathname)) {
        await page.close();
        stop(`${u} is only visible after login (redirected to ${landed.pathname}). If it is the user's own site, attach with --attach to a Chrome they logged in to themselves`);
      }
      const name = `${slug}-${scheme}-${width}`;
      fs.writeFileSync(path.join(out, name + ".json"), JSON.stringify({ scheme, width, ...data }, null, 1));
      await page.screenshot(path.join(out, name + ".png"));
      await page.evaluate("window.scrollTo(0, innerHeight * 1.5)");
      await sleep(1200);
      await page.screenshot(path.join(out, name + "-2.png"));
      await page.close();
      pages.push({ name, url: data.url, title: data.title, elements: data.elements, bg: data.body.bg, theme: data.htmlAttrs.join(" ") });
      if (width !== 1440) { console.log(`${name}: ${data.elements} elements (the narrow width is for checking layout and is not added to the ledger)`); continue; }
      for (const [family, values] of Object.entries(data.families)) {
        for (const [value, count] of Object.entries(values)) {
          const e = ((ledger[scheme] ??= {})[family] ??= {})[value] ??= { count: 0, pages: [] };
          e.count += count;
          if (!e.pages.includes(slug)) e.pages.push(slug);
        }
      }
      console.log(`${name}: ${data.elements} elements, ${Object.keys(data.vars).length} variables, ${data.fonts.length} fonts`);
    }
  }
} finally {
  await b.close();
}
// When light and dark have exactly the same values, the site does not follow the color scheme (it pins the theme with an attribute). Say so.
const same = JSON.stringify(ledger.light?.["surface color"]) === JSON.stringify(ledger.dark?.["surface color"]);
fs.writeFileSync(path.join(out, "ledger.json"), JSON.stringify({ collected: new Date().toISOString().slice(0, 10), urls, pages, followsColorScheme: !same, ledger }, null, 1));
console.log(`\nWritten: ${path.join(out, "ledger.json")}  (${urls.length} pages)`);
if (same) {
  console.log("Light and dark values are identical. The site does not follow prefers-color-scheme and pins its theme.");
  console.log("html attributes: " + [...new Set(pages.map((p) => p.theme))].join("  |  "));
  const bgs = [...new Set(pages.map((p) => p.bg))];
  if (bgs.length > 1) console.log("Some pages have a different background color (the values of the other theme are there): " + pages.map((p) => `${p.name} ${p.bg}`).join(", "));
  console.log("To collect the other theme, look at the attributes above and run again with --light-attr / --dark-attr (e.g. --light-attr data-theme=light). If the attribute does not change the values either, the source does not have that theme.");
}
