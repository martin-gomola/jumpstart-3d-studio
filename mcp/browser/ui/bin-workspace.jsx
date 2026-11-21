import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BIN_SIDES } from "../../shared/gridfinity-walls.js";
import { matrixForTransform } from "../plans/plan-geometry.js";
import { numberValid } from "./field-text.js";
import { NumberField, usePreviewView } from "./controls.jsx";
import { CompartmentFields } from "./part-options.jsx";
import { createPartPlanner, PART_LIMITS, partFit, partReady, partState, partSummary, templatePlan } from "./part-planner.js";

function supportedBaseplates(document) {
  const sketches = new Map(document.sketches.map(sketch => [sketch.id, sketch]));
  return document.bodies.flatMap(body => {
    const grid = body.mcpGridfinity, matrix = body.m;
    const signature = body.mcpDrawerLayout?.nodeSignature ?? grid?.nodeSignature;
    if (grid?.kind !== "baseplate" || body.hidden || body.hole ||
        signature !== JSON.stringify(body.node) || !grid.sketchSignatures ||
        !Object.entries(grid.sketchSignatures).every(([id, saved]) => JSON.stringify(sketches.get(id)) === saved)) return [];
    const angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
    const upright = matrixForTransform(matrix.slice(12, 15), [0, 0, angle]);
    // Cell placement assumes a native, unscaled and upright grid profile.
    if (!upright.every((value, index) => Math.abs(value - matrix[index]) < 1e-6)) return [];
    return [{ id: body.id, name: body.name, grid, matrix, angle }];
  });
}

function binPlacement(baseplate, bin, column, row) {
  const { grid, matrix, angle } = baseplate;
  if (!(Number.isInteger(+column) && +column >= 1 && Number.isInteger(+row) && +row >= 1) ||
      +column - 1 + bin.columns > grid.columns || +row - 1 + bin.rows > grid.rows) {
    throw new Error("The bin extends beyond the baseplate. Change its size or starting cell.");
  }
  const x = (+column - 1 + (bin.columns - grid.columns) / 2) * grid.pitch;
  const y = (+row - 1 + (bin.rows - grid.rows) / 2) * grid.pitch;
  return {
    position: [matrix[12] + matrix[0] * x + matrix[4] * y, matrix[13] + matrix[1] * x + matrix[5] * y, matrix[14] + grid.baseplatePlacementZ],
    rotation: [0, 0, angle],
  };
}

function LiveBin({ preview, createPreviewView, camera, baseplateId }) {
  const container = useRef(null);
  const fallback = usePreviewView(container, preview.previewId, id => createPreviewView(id, baseplateId, camera));
  return <div ref={container} className="ai-preview-content">
    {fallback && <p className="ai-template-note">The interactive 3D view is unavailable.</p>}
  </div>;
}

export function BinWorkspace({ active, hidden, printArea, request, subscribe, getDocument, getRevision, createPreviewView }) {
  const [planner] = useState(createPartPlanner);
  const { draft } = useSyncExternalStore(planner.subscribe, planner.getState);
  const document = useSyncExternalStore(subscribe, getDocument);
  const baseplates = useMemo(() => active ? supportedBaseplates(document) : [], [active, document]);
  const [selection, setSelection] = useState(null);
  const [cell, setCell] = useState({ column: "1", row: "1" });
  const [result, setResult] = useState(null), [retry, setRetry] = useState(0);
  const [applying, setApplying] = useState(false), [notice, setNotice] = useState(null);
  const pending = useRef(null), camera = useRef({}), applyLock = useRef(false);
  const baseplateId = selection?.documentId === document.id ? selection.id : "";
  const baseplate = baseplates.find(entry => entry.id === baseplateId);
  const fit = partFit(draft, true, printArea);
  let formError = "", plan;
  if (!partReady(draft)) formError = "Enter valid dimensions and compartment counts.";
  else if (baseplateId && !baseplate) formError = "That baseplate is unavailable. Choose another baseplate or No baseplate.";
  else {
    const bin = partState(draft);
    plan = templatePlan(bin);
    if (baseplate) try { Object.assign(plan.operations[0], binPlacement(baseplate, bin, cell.column, cell.row)); }
    catch (error) { formError = error.message; plan = null; }
  }
  const planText = plan ? JSON.stringify(plan) : "";
  const current = result?.document === document && result.planText === planText && result.baseplateId === baseplateId && result.retry === retry;
  const building = !!planText && !current;
  const error = formError || (current && result.error) || fit.error || "";

  useEffect(() => {
    if (!active || !planText || applying || current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (pending.current) await pending.current;
      if (cancelled || getDocument() !== document) return;
      const run = async () => {
        const context = { document, planText, baseplateId, retry };
        try {
          const preview = await request("preview_model", { plan: JSON.parse(planText), expectedRevision: getRevision(), includeImage: false });
          if (cancelled) return;
          if (!preview.valid) throw new Error(preview.errors.map(entry => entry.error).join(". "));
          const inspection = await request("inspect_geometry", { previewId: preview.previewId, bodyId: preview.bodies[0].id, mesh: true });
          if (!inspection.meshValidation?.valid || inspection.meshValidation.disconnectedComponents !== 1) {
            throw new Error("The bin did not form one valid connected part.");
          }
          if (!cancelled) setResult({ ...context, preview });
        } catch (error) { if (!cancelled) setResult({ ...context, error: error.message }); }
      };
      pending.current = run();
      await pending.current;
      pending.current = null;
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, planText, document, baseplateId, retry, applying, current, request, getDocument, getRevision]);

  async function add(event) {
    event.preventDefault();
    if (!active || !current || !result.preview || error || applyLock.current || getDocument() !== document) return;
    applyLock.current = true;
    setApplying(true); setNotice(null);
    try {
      await request("apply_model", { previewId: result.preview.previewId });
      setNotice({ document: getDocument(), text: "Bin added. Undo removes it." });
      setResult(null);
    } catch (error) {
      setResult({ ...result, preview: null, error: error.message });
    } finally {
      applyLock.current = false;
      setApplying(false);
    }
  }

  const chooseBaseplate = id => { setSelection({ documentId: document.id, id }); setCell({ column: "1", row: "1" }); setNotice(null); };
  const setField = (key, value) => { planner.setField(key, value); setNotice(null); };
  const dimension = (key, label) => <NumberField id={`standalone-bin-${key}`} label={label} text={draft.fields[key]} limits={PART_LIMITS[key]}
    describedBy="standalone-bin-status" invalid={!numberValid(draft.fields[key], PART_LIMITS[key]) || undefined} disabled={applying}
    onText={text => setField(key, text)} />;
  const location = (key, label, max) => <NumberField id={`standalone-bin-${key}`} label={label} text={cell[key]} limits={{ min: 1, max, step: 1 }}
    describedBy="standalone-bin-status" disabled={applying} onText={text => { setCell(old => ({ ...old, [key]: text })); setNotice(null); }} />;

  return <form className="ai-template-form standalone-bin" hidden={hidden} aria-label="Standalone bin" onSubmit={add} noValidate>
    <section className="ai-template-review" aria-label="Bin preview and baseplate">
      <h3>Live 3D preview</h3>
      <div className="ai-template-preview">
        {active && result?.preview && result.document === document && <LiveBin key={result.preview.previewId} preview={result.preview} createPreviewView={createPreviewView}
          camera={camera.current} baseplateId={result.baseplateId} />}
      </div>
      {(building || !current && result?.preview && result.document === document) && <p className="ai-template-note" role="status">
        {building ? (result?.preview && result.document === document ? "Updating 3D preview…" : "Building 3D preview…") : "Showing the last valid preview."}
      </p>}
      <details className="ai-template-group">
        <summary>{baseplate ? `Baseplate: ${baseplate.name}` : "Use an existing baseplate"}</summary>
        {baseplates.length ? <>
          <div className="ai-template-shapes" role="group" aria-label="Existing baseplates">
            <button type="button" aria-pressed={!baseplateId} disabled={applying} onClick={() => chooseBaseplate("")}>No baseplate</button>
            {baseplates.map(entry => <button key={entry.id} type="button" disabled={applying} aria-pressed={entry.id === baseplateId}
              onClick={() => chooseBaseplate(entry.id)}>{entry.name} · {entry.grid.columns} × {entry.grid.rows}</button>)}
          </div>
          {baseplate && <div className="ai-template-fields">
            {location("column", "Column from left", baseplate.grid.columns)}{location("row", "Row from front", baseplate.grid.rows)}
          </div>}
        </> : <p className="ai-template-note">Add or open a native upright Gridfinity baseplate to place this bin on its grid.</p>}
        {baseplateId && !baseplates.length && <button type="button" disabled={applying} onClick={() => chooseBaseplate("")}>No baseplate</button>}
      </details>
    </section>
    <section className="ai-template-settings" aria-label="Bin settings">
      <div className="ai-controls">
        <fieldset><legend>Dimensions</legend>
          <div className="ai-template-fields">
            {dimension("columns", "Width (cells)")}{dimension("rows", "Depth (cells)")}
          </div>
          {dimension("heightUnits", "Body height (7 mm steps)")}
          <p className="ai-template-note">{partSummary(draft).dimensions}</p>
          <label className="ai-template-field"><input type="checkbox" checked={draft.lip} disabled={applying}
            onChange={event => { planner.setLip(event.target.checked); setNotice(null); }} />Stackable rim</label>
        </fieldset>
        <fieldset><legend>Compartments</legend>
          <CompartmentFields id="standalone-bin-compartments" texts={{ x: draft.fields.compartmentsX, y: draft.fields.compartmentsY }}
            disabled={applying} describedBy="standalone-bin-status"
            invalid={axis => !numberValid(draft.fields[`compartments${axis.toUpperCase()}`], PART_LIMITS.compartmentsX) || undefined}
            onText={(axis, text) => setField(`compartments${axis.toUpperCase()}`, text)} />
        </fieldset>
        <fieldset><legend>Open sides</legend>
          <div className="standalone-bin-sides">
            {BIN_SIDES.map(side => <label key={side} className="ai-template-field">
              <input type="checkbox" checked={draft.openSides.includes(side)} disabled={applying}
                onChange={event => {
                  planner.setWalls(event.target.checked ? [...draft.openSides, side] : draft.openSides.filter(value => value !== side), false);
                  setNotice(null);
                }} />{side[0].toUpperCase() + side.slice(1)}
            </label>)}
          </div>
        </fieldset>
      </div>
      <div className="ai-template-submit">
        <p id="standalone-bin-status" className="ai-template-message" role="status" data-error={error ? "true" : undefined}>
          {applying ? "Adding bin…" : error || (notice?.document === document ? notice.text : fit.rotated ? "Turn the bin 90° on the print bed to fit." : "")}
        </p>
        {current && result.error && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry preview</button>}
        <button type="submit" className="ai-template-primary" disabled={!current || !result.preview || !!error || applying}>Add bin to document</button>
      </div>
    </section>
  </form>;
}
