// Version 2.9.9.8: Flower Studio's assembly instructions as a PDF (A4 pages with pictures), made in the
// browser with no libraries: pictures are drawn by an offscreen three.js renderer and embedded as JPEGs.
import * as THREE from "three";

// ---------------------------------------------------------------- pictures
// parts: [{ mesh: {V, I}, color }]; returns { bytes (JPEG), w, h }
let R0 = null;
export async function picture(parts, opt = {}) {
  const w = opt.w || 1000, h = opt.h || 640;
  if (!R0) R0 = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  const r = R0;
  r.setPixelRatio(1); r.setSize(w, h, false); r.setClearColor(0xffffff, 1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(0.6, -1, 1.4); scene.add(sun);
  const back = new THREE.DirectionalLight(0xffffff, 0.45); back.position.set(-1, 0.8, 0.6); scene.add(back);
  const geos = [];
  for (const p of parts) {
    if (!p.mesh || !p.mesh.I.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p.mesh.V, 3)); g.setIndex(p.mesh.I);
    const ng = g.toNonIndexed(); ng.computeVertexNormals(); g.dispose(); geos.push(ng);
    const faded = opt.fade && opt.fade(p);
    scene.add(new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ color: p.color || "#999999", roughness: 0.65, metalness: 0.05, transparent: !!faded, opacity: faded ? 0.28 : 1 })));
  }
  const box = new THREE.Box3().setFromObject(scene), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, w / h, 1, 100000);
  const az = opt.az ?? -0.65, el = opt.el ?? 0.5, R = Math.max(size.length() / 2, 10);
  const dist = (R / Math.sin((15 * Math.PI) / 180)) * (opt.zoom || 1.0);
  cam.up.set(0, 0, 1);
  cam.position.set(c.x + Math.cos(el) * Math.cos(az) * dist, c.y + Math.cos(el) * Math.sin(az) * dist, c.z + Math.sin(el) * dist);
  cam.lookAt(c);
  // a soft floor
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R * 1.6, 64), new THREE.MeshBasicMaterial({ color: 0xeef1f5 }));
  floor.position.set(c.x, c.y, box.min.z - 0.05); scene.add(floor);
  r.render(scene, cam);
  const blob = await new Promise((res) => r.domElement.toBlob(res, "image/jpeg", 0.85));
  for (const g of geos) g.dispose();
  floor.geometry.dispose();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

// ---------------------------------------------------------------- the PDF
// pages: [{ title, image?: {bytes,w,h}, blocks: [ {h: "Heading"} | {p: "text"} | {li: "text"} | {swatches: [[hex, label]]} ] }]
export function instructionsPDF(doc) {
  const W = 595.28, H = 841.89, M = 48, enc = new TextEncoder();
  // Helvetica only knows plain (WinAnsi) letters: swap the rest
  const plain = (t) => String(t).replace(/[→⇒]/g, "->").replace(/[×]/g, "x").replace(/[°]/g, " deg").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[·•]/g, "-").replace(/[▾]/g, "").replace(/[Øø]/g, "dia. ").replace(/…/g, "...").replace(/[^\x20-\x7e]/g, "");
  const ps = (t) => "(" + plain(t).replace(/[\\()]/g, (ch) => "\\" + ch) + ")";
  const hex = (c) => [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
  // rough Helvetica widths (enough for wrapping)
  const cw = (ch, b) => { const n = "ijl.,:;'|!".includes(ch) ? 0.26 : "frt() -".includes(ch) ? 0.36 : "mwMW".includes(ch) ? 0.83 : ch >= "A" && ch <= "Z" ? 0.66 : ch >= "0" && ch <= "9" ? 0.556 : 0.52; return b ? n * 1.06 : n; };
  const width = (t, size, b) => [...plain(t)].reduce((s, ch) => s + cw(ch, b), 0) * size;
  const wrap = (t, size, max, b) => { const out = []; let line = ""; for (const word of plain(t).split(/\s+/)) { const tryL = line ? line + " " + word : word; if (width(tryL, size, b) > max && line) { out.push(line); line = word; } else line = tryL; } if (line) out.push(line); return out; };

  const objs = []; // each: string, or { dict, data (Uint8Array) } for binary streams
  const add = (o) => { objs.push(o); return objs.length; };
  const catalog = add(null), pagesId = add(null);
  const F1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const F2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  const pagesOut = [];
  // lay the pages out; a page that runs over continues on a new one
  for (const pg of doc.pages) {
    let c = [], y = H - M, imgs = [];
    const newPage = () => { pagesOut.push({ c, imgs }); c = []; imgs = []; y = H - M; };
    const need = (hgt) => { if (y - hgt < M + 30) { newPage(); } };
    // title
    c.push(`BT ${hex("#1d2430")} rg /F2 20 Tf ${M} ${y - 20} Td ${ps(pg.title)} Tj ET`); y -= 30;
    c.push(`${hex("#2f6f4f")} RG 1.2 w ${M} ${y} m ${W - M} ${y} l S`); y -= 14;
    if (pg.image) {
      const maxW = W - 2 * M, maxH = pg.imageH || 300, k = Math.min(maxW / pg.image.w, maxH / pg.image.h), iw = pg.image.w * k, ih = pg.image.h * k;
      need(ih + 8);
      const id = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${pg.image.w} /Height ${pg.image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, data: pg.image.bytes });
      imgs.push(id);
      c.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${(M + (maxW - iw) / 2).toFixed(2)} ${(y - ih).toFixed(2)} cm /Im${id} Do Q`);
      c.push(`${hex("#d6dbe3")} RG 0.6 w ${(M + (maxW - iw) / 2).toFixed(2)} ${(y - ih).toFixed(2)} ${iw.toFixed(2)} ${ih.toFixed(2)} re S`);
      y -= ih + 14;
    }
    for (const b of pg.blocks || []) {
      if (b.h) { need(26); c.push(`BT ${hex("#2f6f4f")} rg /F2 13 Tf ${M} ${y - 13} Td ${ps(b.h)} Tj ET`); y -= 20; continue; }
      if (b.swatches) {
        need(22);
        let x = M;
        for (const [col, label] of b.swatches) {
          const lw = width(label, 10) + 30;
          if (x + lw > W - M) { x = M; y -= 20; need(22); }
          c.push(`${hex(col)} rg ${hex("#8890a0")} RG 0.5 w ${x} ${y - 12} 14 14 re B`);
          c.push(`BT ${hex("#2b2f36")} rg /F1 10 Tf ${x + 19} ${y - 9} Td ${ps(label)} Tj ET`);
          x += lw;
        }
        y -= 22; continue;
      }
      const li = b.li != null, num = b.n != null, text = li ? b.li : num ? b.text : b.p, size = 10.5, ind = li || num ? 16 : 0;
      const lines = wrap(text, size, W - 2 * M - ind, false);
      need(Math.min(lines.length, 3) * 14 + 4);
      if (li) c.push(`${hex("#2f6f4f")} rg ${M + 4} ${y - 8} 3.2 3.2 re f`);
      if (num) c.push(`BT ${hex("#2f6f4f")} rg /F2 ${size} Tf ${M} ${y - size} Td ${ps(b.n + ".")} Tj ET`);
      for (const ln of lines) { need(14); c.push(`BT ${hex("#2b2f36")} rg /F1 ${size} Tf ${M + ind} ${y - size} Td ${ps(ln)} Tj ET`); y -= 14; }
      y -= 5;
    }
    pagesOut.push({ c, imgs });
  }
  // footers, page objects
  pagesOut.forEach((pg, i) => {
    pg.c.push(`${hex("#d6dbe3")} RG 0.6 w ${M} ${M} m ${W - M} ${M} l S`);
    pg.c.push(`BT ${hex("#6b7480")} rg /F1 8.5 Tf ${M} ${M - 14} Td ${ps((doc.footer || "") + "")} Tj ET`);
    const pn = `Page ${i + 1} of ${pagesOut.length}`;
    pg.c.push(`BT ${hex("#6b7480")} rg /F1 8.5 Tf ${(W - M - width(pn, 8.5)).toFixed(2)} ${M - 14} Td ${ps(pn)} Tj ET`);
    const stream = pg.c.join("\n");
    const cont = add({ dict: "<<", data: enc.encode(stream) });
    const xo = pg.imgs.length ? ` /XObject << ${pg.imgs.map((id) => `/Im${id} ${id} 0 R`).join(" ")} >>` : "";
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >>${xo} >> /Contents ${cont} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  // write it out
  const chunks = [enc.encode("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")], offs = [];
  let len = chunks[0].length;
  objs.forEach((o, i) => {
    offs.push(len);
    let b;
    if (typeof o === "string") b = [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)];
    else { const d = o.dict === "<<" ? `<< /Length ${o.data.length} >>` : `${o.dict} /Length ${o.data.length} >>`; b = [enc.encode(`${i + 1} 0 obj\n${d}\nstream\n`), o.data, enc.encode("\nendstream\nendobj\n")]; }
    for (const x of b) { chunks.push(x); len += x.length; }
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info << /Title ${ps(doc.title || "Instructions")} /Producer (JumpStart 3D) >> >>\nstartxref\n${len}\n%%EOF\n`;
  chunks.push(enc.encode(xref));
  const out = new Uint8Array(chunks.reduce((s, p) => s + p.length, 0)); let k = 0; for (const p of chunks) { out.set(p, k); k += p.length; }
  return out;
}
