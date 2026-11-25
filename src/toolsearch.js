// Tool search: type what you want to do ("fillet", "honeycomb", "helmet", "stretch") and run the
// tool straight away, instead of hunting through tabs and menus. Opens from the magnifier in the
// top bar, Ctrl+K / Cmd+K, or "/" when not typing. Works in every mode: Advanced lists every
// ribbon tool of every workspace (Design, 3D Print Sim, Simulate), Chisel lists its brushes and
// tools, Beginner and Architect list their toolbar buttons; Advanced tools can be found from
// any mode (it switches to Advanced first).
import { el } from "./util.js";
import { STATIC_TOOLS } from "./toolindex.js";

// a few extra words people use for tools, so a search finds them
const ALIASES = {
  fillet: "round edges radius smooth corner", chamfer: "bevel edge angle", shell: "hollow wall thickness", extrude: "pull push height", revolve: "lathe spin turn",
  combine: "boolean join union cut subtract intersect merge", "pattern": "array repeat copy row circular", lattice: "honeycomb hex mesh grid infill holes lightweight screen triangles circles",
  expandable: "expand stretch telescope collapsible slide rings ghost flexi spring", "pattern on face": "hexagon knurl diamond texture grip",
  "helmet maker": "helmet cosplay visor space military armor", cosforge: "cosplay costume armor", "storage from shape": "bins drawers organiser", "bin & box maker": "bins boxes organiser carousel honeycomb",
  hole: "drill screw bore counterbore countersink tapped", thread: "screw bolt nut", "split body": "cut slice divide", mirror: "symmetry flip", scale: "resize bigger smaller",
  "move/copy": "translate rotate duplicate", align: "line up center", sketch: "draw 2d profile", text: "letters words font", "3d text": "letters words font",
  printer: "bambu lab h3c h2d h2s x1c p1s p2s a1 mini prusa mk3 mk3s mk3.5 mk3.9 mk4 creality flsun qq-s qqs delta machine swaptek", "send to 3d print sim": "flower print sim slice", "export 3mf": "flower export stl 3mf pieces peg socket print", "flower studio": "flowers bouquet vase arrangement bloom petals garden robot mechanical wreath snap-in snap in petals clip",
  hero: "action figure figurine poseable doll character", heroine: "action figure figurine poseable doll character", "ball joint kit": "action figure poseable joint socket",
  "sparse infill pattern": "infill pattern grid triangles crosshatch rectilinear", "sparse infill smooth factor": "smooth infill orca",
  flexigen: "articulated print in place", gears: "cog spur rack", "quick hinge": "hinge", fasteners: "bolt nut screw washer", hollow: "shell wall",
};

export function initToolSearch(app) {
  let pal = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // the document a harvested control lives in: the page, Chisel's frame, or an app's frame
  const docOf = (t) => {
    if (!t.frame) return document;
    const f = t.frame === "chisel" ? document.querySelector("#chisel-host iframe") : document.querySelector(t.frame);
    try { return f && f.contentDocument; } catch (e) { return null; }
  };
  const waitFor = async (fn, ms = 12000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) return null; await sleep(120); } };
  // go to a control found by the index (switching mode, workspace, app and tab first), then use it
  async function runStatic(t) {
    try {
      if (t.mode && app.mode !== t.mode) { app.switchMode(t.mode); await sleep(400); }
      if (t.ws) {
        if (app.mode !== "advanced") { app.switchMode("advanced"); await sleep(400); }
        const tab = document.getElementById("ws-" + t.ws);
        if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      }
      if (t.mode === "chisel") await waitFor(() => { const d = docOf({ frame: "chisel" }); return d && d.querySelector("#toolSec"); });
      const find = () => { const d = docOf(t); return d && d.querySelector(t.sel); };
      if (t.level && app.chisel && app.chisel.level !== t.level && !find()) { app.chisel.setLevel(t.level); await sleep(300); }
      if (t.opener && !find()) { const o = document.querySelector(t.opener); if (o) o.click(); }
      if (t.tab) { const tb = await waitFor(() => document.querySelector(t.tab)); if (tb) { tb.click(); await sleep(150); } }
      // an app's own tab or mode first (Layerscape's Puzzle maker, CosForge's Helmet…)
      for (const ps of t.pre || []) { const b = await waitFor(() => { const d = docOf(t); return d && d.querySelector(ps); }); if (b && b.getAttribute("aria-pressed") !== "true" && b.getAttribute("aria-selected") !== "true") { b.click(); await sleep(400); } }
      const e = await waitFor(find);
      if (!e) { app.toast && app.toast(`Couldn't find “${t.label}” just now. It's in ${t.group}.`); return; }
      e.scrollIntoView && e.scrollIntoView({ block: "center", inline: "nearest" });
      // show where it is
      const o0 = e.style.outline, oo = e.style.outlineOffset;
      e.style.outline = "3px solid #f5a623"; e.style.outlineOffset = "2px";
      setTimeout(() => { e.style.outline = o0; e.style.outlineOffset = oo; }, 1800);
      if (t.kind === "focus") { e.focus && e.focus(); }
      else if (t.kind === "enter") { e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
      else e.click();
    } catch (err) { console.error(err); }
  }
  const norm = (s) => String(s || "").toLowerCase();
  function domTools() {
    // Beginner / Architect: the toolbar's buttons as they are on screen
    const out = [], seen = new Set();
    for (const b of document.querySelectorAll("#ribbon button, .bb-menu button")) {
      if (!b.id || seen.has(b.id) || b.disabled || b.classList.contains("rcaret") || b.classList.contains("bb-dd")) continue;
      const label = (b.getAttribute("aria-label") || b.textContent || b.title || "").trim();
      if (!label) continue;
      seen.add(b.id);
      const menu = b.closest(".bb-menu");
      out.push({ id: b.id, label: label.split(/[:(]/)[0].trim().slice(0, 40), title: b.title || "", group: (app.mode === "arch" ? "Architect" : "Beginner") + (menu ? " › " + menu.getAttribute("aria-label") : ""), run: () => document.getElementById(b.id)?.click() });
    }
    return out;
  }
  function allTools() {
    let list = [];
    const mode = app.mode;
    if (mode === "chisel") {
      const w = document.querySelector("#chisel-host iframe")?.contentWindow?.__chisel;
      if (w && w.tools) list = w.tools().map((t) => ({ id: "chisel-" + t.id, label: t.name, title: t.hint, group: "Chisel" + (t.cat ? " › " + t.cat : ""), run: () => { const r = w.pickTool(t.id); if (r === "pro") { app.chisel.setLevel("pro"); setTimeout(() => w.pickTool(t.id), 60); } } }));
    } else if (mode !== "advanced") list = domTools();
    // Advanced's tools, from any mode
    if (app.advanced && app.advanced.toolIndex) {
      try {
        const adv = app.advanced.toolIndex().map((t) => ({ ...t, group: "Advanced › " + (t.ws === "print" ? "3D Print Sim › " : t.ws === "simulate" ? "Simulate › " : "") + t.group,
          run: () => { if (app.mode !== "advanced") { app.switchMode("advanced"); setTimeout(() => app.advanced.runTool(t), 120); } else app.advanced.runTool(t); } }));
        list = list.concat(adv);
      } catch (e) { console.error(e); }
    }
    // everything else, from the index: other modes, apps, Chisel's panel, the print sim's settings
    const have = new Set(list.map((t) => (t.group.split(" › ")[0] + "|" + t.label).toLowerCase()));
    for (const t of STATIC_TOOLS) {
      if (t.sel === "#btn-toolsearch") continue;
      const k = (t.group.split(" › ")[0] + "|" + t.label).toLowerCase();
      if (have.has(k)) continue;
      have.add(k);
      list.push({ id: "ix-" + (t.frame || "") + t.sel, label: t.label, title: t.title, group: t.group, run: () => runStatic(t) });
    }
    // the modes themselves
    for (const [m, label] of [["beginner", "Beginner mode"], ["advanced", "Advanced mode"], ["chisel", "Chisel mode (sculpting)"], ["arch", "Architect mode"]]) if (m !== mode) list.push({ id: "mode-" + m, label, title: "Switch to " + label, group: "Modes", run: () => app.switchMode(m) });
    return list;
  }
  function score(t, words) {
    const L = norm(t.label), all = L + " " + norm(t.title) + " " + norm(t.group) + " " + norm(ALIASES[L] || "");
    let s = 0;
    for (const w of words) {
      if (!w) continue;
      if (L === w) s += 100;
      else if (L.startsWith(w)) s += 60;
      else if (L.split(/[\s/&›-]+/).some((p) => p.startsWith(w))) s += 40;
      else if (L.includes(w)) s += 25;
      else if (norm(ALIASES[L] || "").split(/\s+/).some((p) => p.startsWith(w))) s += 22;
      else if (all.includes(w)) s += 8;
      else return 0;
    }
    return s;
  }
  function close() { if (pal) { pal.remove(); pal = null; document.removeEventListener("pointerdown", outside, true); } }
  const outside = (e) => { if (pal && !pal.querySelector(".ts-box").contains(e.target)) close(); };
  function open() {
    if (pal) { pal.querySelector("input").focus(); return; }
    const tools = allTools();
    let sel = 0, shown = [];
    const input = el("input", { id: "ts-input", type: "search", placeholder: "Search tools: fillet, honeycomb, helmet, expandable…", "aria-label": "Search tools", autocomplete: "off", spellcheck: "false" });
    const list = el("div", { id: "ts-list", role: "listbox", "aria-label": "Tools" });
    const box = el("div", { class: "ts-box" }, input, list, el("div", { class: "ts-foot" }, "↑ ↓ to choose · Enter to use · Esc to close"));
    pal = el("div", { id: "ts-pal", class: "ts-pal" }, box);
    document.body.append(pal);
    const run = (t) => { close(); try { t.run ? t.run() : t.fn && t.fn(); } catch (e) { console.error(e); } };
    const draw = () => {
      const q = norm(input.value).trim(), words = q.split(/\s+/);
      if (!q) {
        // nothing typed: the current mode's tools first, then the rest, A to Z
        shown = tools.slice().sort((a, b) => (a.group.startsWith("Advanced") === b.group.startsWith("Advanced") ? a.label.localeCompare(b.label) : app.mode === "advanced" ? 0 : a.group.startsWith("Advanced") ? 1 : -1)).slice(0, 60);
      } else shown = tools.map((t) => ({ t, s: score(t, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.t.label.length - b.t.label.length).slice(0, 40).map((x) => x.t);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = "";
      if (!shown.length) list.append(el("div", { class: "ts-none" }, "No tool matches “" + input.value + "”. Try another word, like “round”, “cut” or “bins”."));
      shown.forEach((t, i) => {
        const b = el("button", { class: "ts-item", role: "option", "aria-selected": String(i === sel), "data-id": t.id, onclick: () => run(t), onpointermove: () => { if (sel !== i) { sel = i; mark(); } } },
          el("span", { class: "ts-l" }, t.label), el("span", { class: "ts-g" }, t.group), t.title && t.title !== t.label ? el("span", { class: "ts-t" }, t.title) : "");
        list.append(b);
      });
    };
    const mark = () => { [...list.children].forEach((c, i) => { if (c.classList.contains("ts-item")) c.setAttribute("aria-selected", String(i === sel)); }); const c = list.children[sel]; if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest" }); };
    input.addEventListener("input", () => { sel = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) run(shown[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      e.stopPropagation();
    });
    document.addEventListener("pointerdown", outside, true);
    draw();
    setTimeout(() => input.focus(), 0);
  }
  // the magnifier in the top bar
  const btn = document.getElementById("btn-toolsearch");
  if (btn) btn.onclick = () => (pal ? close() : open());
  document.addEventListener("keydown", (e) => {
    const typing = e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); e.stopPropagation(); pal ? close() : open(); return; }
    if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !pal) { e.preventDefault(); open(); }
    // in the 3D Print Sim, Space opens the search too (like Orca Slicer 2.5's Speed Dial)
    if (e.key === " " && !typing && !pal && document.body.classList.contains("ps-orca") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); }
  }, true);
  // Ctrl+K inside an app's frame (Layerscape, Neon Sign…) opens the search too
  const hooked = new WeakSet();
  const hookFrame = (f) => {
    try {
      const w = f && f.contentWindow, d = f && f.contentDocument; if (!w || !d || hooked.has(d)) return;
      w.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); e.stopPropagation(); pal ? close() : open(); } }, true);
      hooked.add(d);
    } catch (e) {}
  };
  window.addEventListener("blur", () => setTimeout(() => { const a = document.activeElement; if (a && a.tagName === "IFRAME") hookFrame(a); }, 0));
  setInterval(() => { for (const f of document.querySelectorAll("iframe")) hookFrame(f); }, 1500);
  return { open, close, tools: () => allTools() };
}
