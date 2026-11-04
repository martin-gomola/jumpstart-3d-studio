import { buildGridfinity, normalizeGridfinity } from "./gridfinity.js";
import { drawerParts, normalizeDrawerLayout } from "../../shared/drawer-layout.js";
import { checkPrintFit } from "../../shared/print-area.js";
import { buildPocket, normalizePocket } from "./pockets.js";
import { BASEPLATE_CLIP } from "../../shared/baseplate-clips.js";

function partEditable(body, document) {
  const saved = body.mcpDrawerLayout;
  const signatures = body.mcpGridfinity?.sketchSignatures || body.mcpDrawerSpacer?.sketchSignatures || body.mcpBaseplateClip?.sketchSignatures;
  if (!signatures || typeof signatures !== "object") return false;
  if (body.locked || body.hidden || body.hole || saved.name !== body.name || saved.nodeSignature !== JSON.stringify(body.node) || saved.matrix !== JSON.stringify(body.m)) return false;
  return Object.entries(signatures).every(([id, signature]) => signature === JSON.stringify(document.sketches.find(sketch => sketch.id === id)));
}
export function summarizeDrawerLayouts(document) {
  const layouts = new Map();
  for (const body of document.bodies) {
    const record = body.mcpDrawerLayout;
    if (!record || record.version !== 1 || typeof record.layoutId !== "string" || !record.definition || typeof record.definition !== "object") continue;
    if (!layouts.has(record.layoutId)) layouts.set(record.layoutId, { layoutId: record.layoutId, definition: structuredClone(record.definition), bodyIds: [], editable: true });
    const entry = layouts.get(record.layoutId); entry.bodyIds.push(body.id);
    entry.editable &&= partEditable(body, document);
  }
  for (const entry of layouts.values()) {
    try {
      const expected = drawerParts(entry.definition).map(part => part.id);
      const parts = document.bodies.filter(body => entry.bodyIds.includes(body.id));
      entry.editable &&= expected.length === parts.length && expected.every(id => parts.filter(body => body.mcpDrawerLayout.partId === id).length === 1) && parts.every(body => JSON.stringify(body.mcpDrawerLayout.definition) === JSON.stringify(entry.definition));
    } catch { entry.editable = false; }
  }
  return [...layouts.values()];
}
export function buildDrawerLayout(raw, { document, addBody, idFactory, nextSeq, matrixForTransform }) {
  const op = normalizeDrawerLayout(raw);
  const previous = document.bodies.filter(body => body.mcpDrawerLayout?.layoutId === op.layoutId);
  if (previous.length && !op.replaceExisting) throw new Error("Drawer layout already exists; load it and explicitly replace it after preview");
  if (previous.length && !summarizeDrawerLayouts(document).find(layout => layout.layoutId === op.layoutId)?.editable) throw new Error("Drawer parts were edited, locked or removed; keep the native edits or create a new layout");
  const oldIds = new Set(previous.map(body => body.id)), oldSketchIds = new Set();
  for (const body of previous) for (const id of Object.keys(body.mcpGridfinity?.sketchSignatures || body.mcpDrawerSpacer?.sketchSignatures || body.mcpBaseplateClip?.sketchSignatures || {})) oldSketchIds.add(id);
  const unrelated = document.bodies.filter(body => !oldIds.has(body.id));
  const external = [unrelated.map(body => body.node), document.sketches.filter(sketch => !oldSketchIds.has(sketch.id)), document.planes || [], document.joints || []];
  if (external.some(value => [...oldIds, ...oldSketchIds].some(id => JSON.stringify(value).includes(JSON.stringify(id))))) throw new Error("Another native feature depends on this drawer; preserve it or create a new layout");
  document.bodies = unrelated;
  document.sketches = document.sketches.filter(sketch => !oldSketchIds.has(sketch.id));
  const definition = { ...op, replaceExisting: false }, created = [];
  const own = (body, spec) => {
    body.mcpDrawerLayout = { version: 1, layoutId: op.layoutId, partId: spec.id, name: body.name, definition, nodeSignature: JSON.stringify(body.node), matrix: JSON.stringify(body.m) };
    const old = previous.find(part => part.mcpDrawerLayout.partId === spec.id);
    if (old?.role !== undefined) body.role = old.role;
    if (old?.color !== undefined) body.color = old.color;
    created.push(body);
  };
  for (const { clipSlots, pockets = [], integratedSpacers = [], ...spec } of drawerParts(op)) {
    if (spec.type === "baseplateClip") {
      const { arm, barb } = BASEPLATE_CLIP;
      const box = (w, d, h, x, z) => ({
        node: { t: "prim", kind: "box", p: { w: spec.axis === "x" ? w : d, d: spec.axis === "x" ? d : w, h, r: 0, c: 0 }, mods: [] },
        m: matrixForTransform(spec.axis === "x" ? [x, 0, z] : [0, x, z], [0, 0, 0]), hole: false,
      });
      const node = { t: "group", mods: [], children: [
        box(spec.width, spec.length, arm, 0, spec.height - arm),
        ...[-1, 1].flatMap(sign => {
          const tip = box(arm + barb, spec.length, 0.8, sign * (spec.width - arm + barb) / 2, 0);
          const x = sign * (arm - barb) / 2;
          tip.node.mods.push({ t: "halfspace", plane: { o: spec.axis === "x" ? [x, 0, 0] : [0, x, 0], n: spec.axis === "x" ? [-sign * 0.3, 0, barb] : [0, -sign * 0.3, barb] }, side: 1 });
          return [box(arm, spec.length, spec.height, sign * (spec.width - arm) / 2, 0), tip];
        }),
      ] };
      const body = addBody(spec.name, node, matrixForTransform(spec.position, [0, 0, 0]));
      body.mcpBaseplateClip = { opening: "top", style: "staple", axis: spec.axis, joint: spec.joint, clearance: spec.clearance, width: spec.width, length: spec.length, height: spec.height, sketchSignatures: {} };
      own(body, spec); continue;
    }
    if (spec.type === "drawerSpacer") {
      const node = { t: "group", mods: [], children: spec.rectangles.map(rect => ({
        node: { t: "prim", kind: "box", p: { w: rect.width, d: rect.depth, h: spec.height, r: 0, c: 0 }, mods: [] },
        m: matrixForTransform([rect.x, rect.y, 0], [0, 0, 0]), hole: false,
      })) };
      const body = addBody(spec.name, node, matrixForTransform(spec.position, [0, 0, 0]));
      body.mcpDrawerSpacer = { corner: spec.corner, clearance: spec.clearance, height: spec.height, legLength: spec.legLength, sketchSignatures: {} };
      if (op.printArea) body.mcpPrintFit = checkPrintFit(op.printArea, Math.max(...spec.rectangles.map(rect => rect.width)), Math.max(...spec.rectangles.map(rect => rect.depth)), spec.height, spec.name);
      body.mcpDrawerLayout = { version: 1, layoutId: op.layoutId, partId: spec.id, name: body.name, definition, nodeSignature: JSON.stringify(body.node), matrix: JSON.stringify(body.m) };
      const old = previous.find(part => part.mcpDrawerLayout.partId === spec.id);
      if (old?.role !== undefined) body.role = old.role;
      if (old?.color !== undefined) body.color = old.color;
      created.push(body); continue;
    }
    const normalized = normalizeGridfinity(spec);
    const built = buildGridfinity(normalized, { document, idFactory, nextSeq, clipSlots });
    if (integratedSpacers.length) {
      const children = [{ node: built.node, m: matrixForTransform([0, 0, 0], [0, 0, 0]), hole: false }];
      for (const spacer of integratedSpacers) for (const rect of spacer.rectangles) {
        const node = { t: "prim", kind: "box", p: { w: rect.width, d: rect.depth, h: spacer.height, r: 0, c: 0 }, mods: [] };
        const pos = [spacer.position[0] + rect.x - normalized.position[0], spacer.position[1] + rect.y - normalized.position[1], 0];
        children.push({ node, m: matrixForTransform(pos, [0, 0, 0]), hole: false });
      }
      for (const spacer of integratedSpacers) {
        const { x, y, sx, sy, radius } = spacer.bridge;
        const points = [[x, y - sy * radius], [x, y], [x - sx * radius, y], [x - sx * radius, y - sy * radius]];
        const sketch = { id: idFactory("s"), name: `Rounded spacer join ${spacer.corner}`, seq: nextSeq ? nextSeq() : ++document.seq,
          plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], hidden: true };
        const point = ([px, py]) => { const id = idFactory("p"); sketch.pts.push({ id, x: px, y: py }); return id; };
        const [a, b, c] = points.slice(0, 3).map(point);
        const arcCenter = point(points[3]);
        if (sx === sy) sketch.ents.push({ id: idFactory("e"), t: "line", a: c, b }, { id: idFactory("e"), t: "line", a: b, b: a },
          { id: idFactory("e"), t: "arc", a, b: c, c: arcCenter });
        else sketch.ents.push({ id: idFactory("e"), t: "line", a, b }, { id: idFactory("e"), t: "line", a: b, b: c },
          { id: idFactory("e"), t: "arc", a: c, b: a, c: arcCenter });
        document.sketches.push(sketch);
        built.recipe.sketchSignatures[sketch.id] = JSON.stringify(sketch);
        const profile = { key: sketch.ents.map(entity => entity.id).sort().join(","), pt: [0, 0] };
        children.push({ node: { t: "extrude", sketch: sketch.id, profiles: [profile], dist: 5, mode: "one", dist2: 0, mods: [] },
          m: matrixForTransform([0, 0, 0], [0, 0, 0]), hole: false });
      }
      built.node = { t: "group", mods: [], children };
    }
    const body = addBody(normalized.name, built.node, matrixForTransform(normalized.position, [0, 0, 0]));
    body.mcpGridfinity = built.recipe;
    if (integratedSpacers.length) body.mcpGridfinity.integratedSpacers = integratedSpacers.map(({ id, corner, clearance, height, legLength }) => ({ id, corner, clearance, height, legLength }));
    for (const pocket of pockets) {
      try { buildPocket(normalizePocket(pocket), { document, target: body, idFactory, nextSeq }); }
      catch (error) { throw new Error(`${normalized.name}: ${error.message}`); }
    }
    if (op.printArea) body.mcpPrintFit = checkPrintFit(op.printArea, built.recipe.width, built.recipe.depth, built.recipe.totalHeight, normalized.name);
    body.mcpDrawerLayout = { version: 1, layoutId: op.layoutId, partId: spec.id, name: body.name, definition, nodeSignature: JSON.stringify(body.node), matrix: JSON.stringify(body.m) };
    const old = previous.find(part => part.mcpDrawerLayout.partId === spec.id);
    if (old?.role !== undefined) body.role = old.role;
    if (old?.color !== undefined) body.color = old.color;
    created.push(body);
  }
  return { bodies: created, removedBodyIds: [...oldIds] };
}
