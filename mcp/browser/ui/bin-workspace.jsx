import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { matrixForTransform } from "../plans/plan-geometry.js";
import { binFootprint } from "../../shared/gridfinity-walls.js";
import { numberValid } from "./field-text.js";
import { MagnetControls, NumberField, WallControls } from "./controls.jsx";
import { BinDimensions, CompartmentFields, FingerScoopControl, PartDividerPositions, ThicknessFields } from "./part-options.jsx";
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
  const container = useRef(null), viewer = useRef(null);
  const [fallback, setFallback] = useState(false);
  useLayoutEffect(() => {
    try {
      const view = createPreviewView(preview.previewId, baseplateId, camera, viewer.current);
      if (!viewer.current) container.current.append(view.element);
      viewer.current = view;
      setFallback(false);
    } catch {
      viewer.current?.dispose();
      viewer.current = null;
      setFallback(true);
    }
  }, [preview.previewId, baseplateId, camera, createPreviewView]);
  useLayoutEffect(() => () => { viewer.current?.dispose(); viewer.current = null; }, []);
  return <>
    <div ref={container} className="ai-preview-content" />
    {fallback && <p className="ai-template-note" role="status">The interactive 3D view is unavailable.</p>}
  </>;
}

export function BinWorkspace({ active, hidden, printArea, request, subscribe, getDocument, getRevision, createPreviewView }) {
  const [planner] = useState(createPartPlanner);
  const state = useSyncExternalStore(planner.subscribe, planner.getState);
  const [magnets, setMagnets] = useState({ valid: true, value: false });
  const draft = { ...state.draft, magnets: magnets.value };
  const document = useSyncExternalStore(subscribe, getDocument);
  const baseplates = useMemo(() => active ? supportedBaseplates(document) : [], [active, document]);
  const [selection, setSelection] = useState(null);
  const [cell, setCell] = useState({ column: "1", row: "1" });
  const [result, setResult] = useState(null), [retry, setRetry] = useState(0);
  const [lastValid, setLastValid] = useState(null);
  const [applying, setApplying] = useState(false), [notice, setNotice] = useState(null);
  const pending = useRef(null), camera = useRef({}), applyLock = useRef(false);
  const baseplateId = selection?.documentId === document.id ? selection.id : "";
  const baseplate = baseplates.find(entry => entry.id === baseplateId);
  const bin = partState(draft);
  const summary = partSummary(draft);
  const fit = partFit(draft, magnets.valid, printArea);
  let formError = "", plan;
  if (!magnets.valid) formError = "Enter valid magnet pocket dimensions.";
  else if (!partReady(draft)) formError = "Enter valid bin dimensions, thicknesses and compartment counts.";
  else if (baseplateId && !baseplate) formError = "That baseplate is unavailable. Choose another baseplate or No baseplate.";
  else {
    plan = templatePlan(bin);
    if (baseplate) try { Object.assign(plan.operations[0], binPlacement(baseplate, bin, cell.column, cell.row)); }
    catch (error) { formError = error.message; plan = null; }
  }
  const planText = plan ? JSON.stringify(plan) : "";
  const current = result?.document === document && result.planText === planText && result.baseplateId === baseplateId && result.retry === retry;
  const building = !!planText && !current;
  const shown = lastValid?.document === document ? lastValid : null;
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
          if (!cancelled) {
            const next = { ...context, preview };
            setResult(next);
            setLastValid(next);
          }
        } catch (error) { if (!cancelled) setResult({ ...context, error: error.message }); }
      };
      pending.current = run();
      await pending.current;
      pending.current = null;
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, planText, document, baseplateId, retry, applying, current, request, getDocument, getRevision]);

  async function add() {
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
  const fitsPrinter = (key, value) => !partFit({ ...draft, fields: { ...draft.fields, [key]: String(value) } }, magnets.valid, printArea).error;
  const location = (key, label, max) => <NumberField id={`standalone-bin-${key}`} label={label} text={cell[key]} limits={{ min: 1, max, step: 1 }}
    describedBy="standalone-bin-status" disabled={applying} onText={text => { setCell(old => ({ ...old, [key]: text })); setNotice(null); }} />;

  const status = applying ? "Adding bin…" : error || (notice?.document === document ? notice.text : fit.rotated ? "Turn the bin 90° on the print bed to fit." : "");
  const baseplateChoice = <details className="ai-template-group">
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
  </details>;
  const settings = <div className="ai-controls">
    <fieldset><legend>Dimensions</legend>
      <BinDimensions bin={bin} envelope={binFootprint(bin)} limits={{ columns: PART_LIMITS.columns.max, rows: PART_LIMITS.rows.max }}
        disabled={applying} canIncrease={fitsPrinter} canUseHeight={units => fitsPrinter("heightUnits", units)}
        onChange={(key, value) => setField(key, String(value))}
        heightField={<NumberField id="standalone-bin-heightUnits" label="Body height (7 mm steps)" text={draft.fields.heightUnits}
          limits={PART_LIMITS.heightUnits} describedBy="standalone-bin-status" disabled={applying}
          invalid={!numberValid(draft.fields.heightUnits, PART_LIMITS.heightUnits) || undefined} onText={text => setField("heightUnits", text)} />} />
      <p className="ai-template-note">{summary.dimensions}</p>
      <label className="ai-template-field"><input type="checkbox" checked={draft.lip} disabled={applying}
        onChange={event => { planner.setLip(event.target.checked); setNotice(null); }} />Stackable rim</label>
    </fieldset>
    <fieldset className="gridfinity-compartment-fields"><legend>Compartments</legend>
      <CompartmentFields id="standalone-bin-compartments" texts={{ x: draft.fields.compartmentsX, y: draft.fields.compartmentsY }}
        disabled={applying} describedBy="standalone-bin-status"
        invalid={axis => !numberValid(draft.fields[`compartments${axis.toUpperCase()}`], PART_LIMITS.compartmentsX) || undefined}
        onText={(axis, text) => setField(`compartments${axis.toUpperCase()}`, text)} />
    </fieldset>
    <WallControls id="standalone-bin-close-gaps" heading="Open sides" value={draft.openSides} closeGaps={draft.closeGaps} disabled={applying}
      onChange={(sides, closeGaps) => { planner.setWalls(sides, closeGaps); setNotice(null); }}
      onCloseGaps={value => { planner.setCloseGaps(value); setNotice(null); }} />
    <FingerScoopControl value={draft.fingerScoop} slope={draft.fingerScoopSlope} openSides={draft.openSides} disabled={applying}
      onChange={(side, slope) => { planner.setFingerScoop(side, slope); setNotice(null); }} />
    <details className="ai-template-group">
      <summary>Construction &amp; magnets</summary>
      <ThicknessFields id="standalone-bin" texts={draft.fields} disabled={applying} describedBy="standalone-bin-status" onText={setField}
        invalid={name => !numberValid(draft.fields[name], PART_LIMITS[name]) || undefined} />
      <MagnetControls id="standalone-bin-magnets" value={state.draft.magnets} disabled={applying}
        onChange={planner.setMagnets} onValid={(valid, value) => { setMagnets({ valid, value }); setNotice(null); }} />
    </details>
    {baseplateChoice}
  </div>;
  const dividerEditor = <PartDividerPositions id="standalone-bin-divider" message="standalone-bin-status" draft={draft} disabled={applying}
    showEmptyPlan onCommit={value => { planner.setDividerPositions(value); setNotice(null); }} />;

  return <form className="ai-template-form standalone-bin gridfinity-workbench" hidden={hidden} aria-label="Standalone bin" onSubmit={event => event.preventDefault()} noValidate>
    <div className="gridfinity-workbench-columns">
      <section className="ai-template-review standalone-bin-stage gridfinity-compartment-stage" aria-label="Compartment design">
        <div className="standalone-bin-views">
          <div className="standalone-bin-plan">
            <h3>Compartment layout</h3>
            {dividerEditor}
          </div>
          <div className="ai-template-preview standalone-bin-live" aria-label="Live bin model">
            {active && shown && <LiveBin preview={shown.preview} createPreviewView={createPreviewView}
              camera={camera.current} baseplateId={shown.baseplateId} />}
            {(building || shown && (!current || shown !== result)) && <p className="ai-template-note" role="status">
              {building ? "Updating 3D model…" : "Showing the last valid model."}
            </p>}
          </div>
        </div>
      </section>
      <section className="ai-template-settings" aria-label="Bin design settings">
        {settings}
        <div className="ai-template-submit">
          {current && result.error && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry preview</button>}
          <p id="standalone-bin-status" className="ai-template-message" role="status" data-error={error ? "true" : undefined}>{status}</p>
          <button type="button" className="ai-template-primary" onClick={add} disabled={!current || !result?.preview || !!error || applying}>Add bin to document</button>
        </div>
      </section>
    </div>
  </form>;
}
