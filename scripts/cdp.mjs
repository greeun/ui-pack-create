// Shared helpers for site-collect.mjs, site-fidelity.mjs and origin-check.mjs. Needs only Node 22 and Chrome, nothing else to install.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts a new headless Chrome (when attach is not given) or attaches to the debugging port of a Chrome that is already running.
export async function browser({ attach } = {}) {
  let chrome = null, profile = null, port = attach;
  if (!port) {
    port = 19000 + Math.floor(Math.random() * 900);
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "ui-pack-cdp-"));
    chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  }
  for (let i = 0; i < 60; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  async function open(url, { width = 1440, height = 1000, scheme = "light", wait = 5000, motion = "no-preference" } = {}) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    let seq = 0;
    const waiting = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.bad(new Error(JSON.stringify(m.error))) : w.ok(m.result); }
    };
    const send = (method, params = {}) => new Promise((ok, bad) => { const id = ++seq; waiting.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params })); });
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: motion }] });
    await send("Page.navigate", { url });
    await sleep(wait);
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500));
      return r.result.value;
    };
    await evaluate("document.fonts.ready.then(() => true)");
    return {
      send, evaluate,
      screenshot: async (file) => fs.writeFileSync(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")),
      close: async () => { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {}); ws.close(); },
    };
  }
  async function close() {
    if (!chrome) return; // never quit a Chrome we attached to (the window the user logged in with)
    chrome.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return { open, close };
}

// Collects the computed styles of the visible elements, counted per value. scope is a CSS selector (the whole document when omitted).
// Colors are converted to sRGB through a canvas and written as "#rrggbb" or "#rrggbbaa" (removes notation differences such as oklch).
export const collectExpr = (scope) => `(() => {
  const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : "document.body"};
  if (!root) return null;
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const memo = new Map();
  const hex = (c) => {
    if (memo.has(c)) return memo.get(c);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    const v = a === 0 ? null : "#" + [r, g, b].concat(a < 255 ? [a] : []).map((n) => n.toString(16).padStart(2, "0")).join("");
    memo.set(c, v); return v;
  };
  const fam = {};
  const add = (f, v, n = 1) => { if (v == null || v === "") return; (fam[f] ??= {})[v] = (fam[f][v] || 0) + n; };
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 + "px" : null; };
  const shadow = (s) => s === "none" ? null : s.split(/,(?![^(]*\\))/).map((p) => p.trim())
    .filter((p) => !/rgba\\(0, 0, 0, 0\\)|transparent/.test(p)).join(", ") || null;
  const samples = { headings: new Map(), buttons: new Map(), inputs: new Map(), links: new Map(), boxes: new Map() };
  const sample = (kind, el, s, r) => {
    const o = { tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 30),
      w: Math.round(r.width), h: Math.round(r.height), font: s.fontSize + " " + s.fontWeight + " ls " + s.letterSpacing, color: hex(s.color), bg: hex(s.backgroundColor),
      border: parseFloat(s.borderTopWidth) > 0 ? s.borderTopWidth + " " + hex(s.borderTopColor) : null, radius: s.borderTopLeftRadius, shadow: shadow(s.boxShadow), padding: s.padding };
    const key = JSON.stringify([o.h, o.font, o.color, o.bg, o.border, o.radius, o.shadow]);
    const m = samples[kind];
    if (m.has(key)) m.get(key).count++; else m.set(key, { ...o, count: 1 });
  };
  let seen = 0;
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (seen > 8000) break;
    if (el.closest("svg") && el.tagName !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.opacity === "0") continue;
    seen++;
    const tag = el.tagName.toLowerCase();
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      add("text color", hex(s.color)); add("font", s.fontFamily.split(",")[0].trim().replace(/["']/g, ""));
      add("font size", px(s.fontSize)); add("font weight", s.fontWeight);
      if (s.letterSpacing !== "normal") add("letter spacing", Math.round(parseFloat(s.letterSpacing) / parseFloat(s.fontSize) * 1000) / 1000 + "em");
    }
    const bg = hex(s.backgroundColor);
    const bordered = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none";
    const sh = shadow(s.boxShadow);
    if (bg && el !== document.body) add("surface color", bg);
    if (bordered) add("border color", hex(s.borderTopColor));
    if ((bg || bordered || sh) && parseFloat(s.borderTopLeftRadius) > 0) add("radius", parseFloat(s.borderTopLeftRadius) >= 999 || parseFloat(s.borderTopLeftRadius) >= r.height / 2 ? "pill" : px(s.borderTopLeftRadius));
    if (sh) add("shadow", sh);
    const interactive = /^(button|input|select|textarea)$/.test(tag) || el.getAttribute("role") === "button";
    if (interactive) {
      // Count the height only for controls that have a shape (surface, border, shadow) and a clickable size. Skips wrapper buttons and hidden inputs.
      if ((bg || bordered || sh) && r.height >= 16 && r.width >= 16) add("control height", Math.round(r.height) + "px");
      const d = s.transitionDuration.split(",").map((t) => t.trim()).filter((t) => t !== "0s");
      if (d.length) add("transition", d[0] + " " + s.transitionTimingFunction.split(/,(?![^(]*\\))/)[0].trim());
    }
    if ((s.display.includes("flex") || s.display.includes("grid")) && parseFloat(s.rowGap) > 0) add("gap", px(s.rowGap));
    if ((bg || bordered || sh) && r.width > 60 && r.height > 24 && parseFloat(s.paddingTop) > 0) add("padding", px(s.paddingTop));
    if (/^h[1-4]$/.test(tag)) sample("headings", el, s, r);
    else if (tag === "button" || el.getAttribute("role") === "button") sample("buttons", el, s, r);
    else if (/^(input|select|textarea)$/.test(tag)) sample("inputs", el, s, r);
    else if (tag === "a") sample("links", el, s, r);
    else if ((bg || bordered || sh) && r.width > 120 && r.height > 40) sample("boxes", el, s, r);
  }
  const vars = {};
  try { for (const [k, v] of document.documentElement.computedStyleMap()) if (k.startsWith("--") && Object.keys(vars).length < 600) vars[k] = String(v).trim().slice(0, 200); } catch {}
  const bs = getComputedStyle(document.body);
  let pageBg = hex(bs.backgroundColor) || hex(getComputedStyle(document.documentElement).backgroundColor) || "#ffffff";
  add("surface color", pageBg, 50);
  return {
    url: location.href, title: document.title, elements: seen,
    htmlAttrs: [...document.documentElement.attributes].map((a) => a.name + "=" + a.value.slice(0, 60)),
    body: { bg: pageBg, color: hex(bs.color), font: bs.fontFamily.slice(0, 120), size: bs.fontSize, lineHeight: bs.lineHeight },
    fonts: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "") + " " + f.weight))].slice(0, 40),
    families: fam,
    samples: Object.fromEntries(Object.entries(samples).map(([k, m]) => [k, [...m.values()].sort((a, b) => b.count - a.count).slice(0, 14)])),
    vars,
  };
})()`;

// "#rrggbb[aa]" → OKLCH. Used to tell whether a color is chromatic (c >= 0.04) and to read its hue angle.
export function oklch(hexColor) {
  const n = hexColor.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360, a: n.length === 8 ? parseInt(n.slice(6), 16) / 255 : 1 };
}
export const chromatic = (hexColor) => oklch(hexColor).c >= 0.04;
export const hueGap = (a, b) => { const d = Math.abs(oklch(a).h - oklch(b).h); return Math.min(d, 360 - d); };
export function rgbClose(a, b, tol = 8) {
  const p = (h) => { const n = h.replace("#", ""); return [0, 2, 4, 6].map((i) => (n.length > i ? parseInt(n.slice(i, i + 2), 16) : 255)); };
  const x = p(a), y = p(b);
  return x.slice(0, 3).every((v, i) => Math.abs(v - y[i]) <= tol) && Math.abs(x[3] - y[3]) <= 16;
}
