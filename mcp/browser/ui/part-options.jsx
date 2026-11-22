import { useRef } from "react";
import { numberValid } from "./field-text.js";
import { POCKET_LIMITS, COMPARTMENT_LIMITS, pocketFieldUsed } from "./pocket-draft.js";
import { NumberField } from "./controls.jsx";
import { DividerPositionEditor } from "./divider-position-editor.jsx";
import { PART_LIMITS, partState } from "./part-planner.js";

// Options shared by the Gridfinity part dialog and the drawer's bin inspector. Each caller owns the texts and decides when an edit is committed.
const SHAPES = [["roundedRect", "Rounded"], ["circle", "Circle"], ["capsule", "Capsule"]];
const EVIDENCE = [["estimate", "Estimate"], ["measured", "Measured"], ["manufacturer", "Published"], ["model", "Model"]];
export const THICKNESS_LIMITS = { floor: { min: 0.8, max: 6 }, wall: { min: 0.8, max: 4 } };

export function FingerScoopControl({ value, slope, openSides, disabled, onChange }) {
  const walls = ["front", "back", "left", "right"];
  const firstClosed = walls.find(side => !openSides.includes(side));
  return <div className="ai-template-group">
    <span>Finger scoop</span>
    <div className="ai-template-shapes" role="group" aria-label="Finger scoop">
      {["0 Off", "1 Standard", "2 Steep"].map((label, level) => <button key={level} type="button"
        aria-pressed={level === (value ? slope ?? 1 : 0)} disabled={disabled || level > 0 && !firstClosed}
        onClick={() => onChange(level ? value || firstClosed : undefined, level === 2 ? 2 : undefined)}>{label}</button>)}
    </div>
    {value && <div className="ai-template-shapes" role="group" aria-label="Finger scoop wall">
      {walls.map(side => <button key={side} type="button" aria-pressed={side === value} disabled={disabled || openSides.includes(side)}
        onClick={() => onChange(side, slope)}>{side[0].toUpperCase() + side.slice(1)}</button>)}
    </div>}
    <p className="ai-template-note">{firstClosed ? "Full-width ramp along a closed wall." : "Close a wall to add a finger scoop."}</p>
  </div>;
}

export function BinDimensions({ bin, envelope, limits, disabled, canIncrease, canUseHeight, onChange, heightField }) {
  const heights = [2, 3, 5, 7];
  if (numberValid(String(bin.heightUnits), PART_LIMITS.heightUnits) && !heights.includes(bin.heightUnits)) {
    heights.push(bin.heightUnits);
    heights.sort((a, b) => a - b);
  }
  return <>
    <div className="ai-template-fields gridfinity-footprint">
      {[["columns", "Width", envelope.width], ["rows", "Depth", envelope.depth]].map(([key, label, mm]) => (
        <div className="drawer-stepper" key={key}>
          <span>{label}</span>
          <div>
            <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || bin[key] <= 1}
              onClick={() => onChange(key, bin[key] - 1)}>−</button>
            <output>{`${bin[key]} cells`}</output>
            <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || bin[key] >= limits[key] || !canIncrease(key, bin[key] + 1)}
              onClick={() => onChange(key, bin[key] + 1)}>+</button>
          </div>
          <small>{`${mm} mm`}</small>
        </div>
      ))}
    </div>
    <span>Height</span>
    <div className="ai-template-shapes" role="group" aria-label="Bin height">
      {heights.map(units => <button key={units} type="button" disabled={disabled || !canUseHeight(units)}
        aria-pressed={String(bin.heightUnits === units)} onClick={() => onChange("heightUnits", units)}>{`${units * 7} mm`}</button>)}
    </div>
    <details className="ai-template-group">
      <summary>More heights</summary>
      {heightField}
    </details>
  </>;
}

export function ThicknessFields({ id, texts, onText, onCommit, onEdit, invalid = () => undefined, disabled, describedBy }) {
  return <div className="ai-template-fields">
    {[["floor", "Floor thickness (mm)"], ["wall", "Wall thickness (mm)"]].map(([name, label]) => <NumberField key={name} id={`${id}-${name}`} label={label} text={texts[name]}
      limits={THICKNESS_LIMITS[name]} disabled={disabled} describedBy={describedBy} invalid={invalid(name)}
      onText={text => onText(name, text)} onEdit={text => onEdit?.(name, text)} onCommit={onCommit && (text => onCommit(name, text))} />)}
  </div>;
}

export function CompartmentFields({ id, texts, onText, onCommit, onEdit, invalid = () => undefined, disabled, describedBy }) {
  return <div className="ai-template-fields">
    {[["x", "Compartments across width"], ["y", "Compartments along depth"]].map(([axis, label]) => <NumberField key={axis} id={`${id}-${axis}`} label={label} text={texts[axis]}
      limits={COMPARTMENT_LIMITS} disabled={disabled} describedBy={describedBy} invalid={invalid(axis)}
      onText={text => onText(axis, text)} onEdit={text => onEdit?.(axis, text)} onCommit={onCommit && (text => onCommit(axis, text))} />)}
  </div>;
}

export function PartDividerPositions({ id, message, draft, disabled, onCommit, showEmptyPlan = false }) {
  if (!["columns", "rows", "wall", "compartmentsX", "compartmentsY"].every(key => numberValid(draft.fields[key], PART_LIMITS[key]))) return null;
  const bin = partState(draft);
  const dividers = { x: bin.compartmentsX - 1, y: bin.compartmentsY - 1 };
  return <DividerPositionEditor id={id} message={message} bin={{ ...bin, dividers }} wall={bin.wall} disabled={disabled} onCommit={onCommit} showEmptyPlan={showEmptyPlan} />;
}

// `onPatch(patch, commit)` commits discrete choices at once; typed text commits through `onCommit` when the field changes.
export function PocketForm({ pocket, id, titleId, describedBy, disabled, references, onPatch, onField, onCommit = () => {}, onReference, onRemove, invalid = () => undefined, onValidity = () => {} }) {
  const { index, shape } = pocket;
  const widthRef = useRef(null);
  const field = (name, label) => {
    const off = !pocketFieldUsed(shape, name);
    return <NumberField id={id(name)} label={label} text={pocket.fields[name]} limits={POCKET_LIMITS[name]} describedBy={describedBy}
      disabled={disabled || off} hidden={off} inputRef={name === "width" ? widthRef : undefined} invalid={invalid(id(name))}
      onText={text => onField(name, text)} onEdit={text => onValidity(id(name), numberValid(text, POCKET_LIMITS[name]))} onCommit={() => onCommit()} />;
  };
  const choices = (label, entries, current, key) => <div className="ai-template-shapes" aria-label={label}>
    {entries.map(([value, text]) => <button key={value} type="button" aria-pressed={String(value === current)} disabled={disabled} onClick={() => onPatch({ [key]: value }, true)}>{text}</button>)}
  </div>;
  const text = (name, label, type, maxLength) => <label className="ai-template-field" htmlFor={id(name)}>
    <span>{label}</span>
    <input id={id(name)} type={type} maxLength={maxLength} value={pocket[name]} disabled={disabled} aria-invalid={name === "url" && invalid(id(name)) && "true"}
      onChange={event => { onPatch({ [name]: event.target.value }, false); if (name === "url") onValidity(id(name), event.target.validity.valid); }} onBlur={() => onCommit()} />
  </label>;
  return <section className="ai-template-pocket" aria-labelledby={titleId}>
    <header>
      <h4 id={titleId}>{`Pocket ${index}`}</h4>
      <button type="button" className="ai-template-remove" aria-label={`Remove pocket ${index}`} disabled={disabled} onClick={onRemove}>Remove</button>
    </header>
    {shape === "contour" ? <p className="ai-template-note">{`Traced outline, ${pocket.profile.segments.length} segments. Its shape is fixed here; position, depth and fit stay editable.`}</p>
      : choices(`Pocket ${index} shape`, SHAPES, shape, "shape")}
    <div className="ai-template-fields">{field("width", "Width / diameter (mm)")}{field("height", "Length (mm)")}{field("depth", "Pocket depth (mm)")}</div>
    <details>
      <summary>Position &amp; fit</summary>
      <div className="ai-template-fields">
        {field("radius", "Corner radius (mm)")}{field("clearance", "Clearance per side (mm)")}
        {field("x", "Centre X (mm)")}{field("y", "Centre Y (mm)")}{field("rotation", "Rotation about Z (degrees)")}
        <label className="ai-template-field" htmlFor={id("merge")}>
          <input id={id("merge")} type="checkbox" checked={pocket.merge} disabled={disabled} onChange={event => onPatch({ merge: event.target.checked }, true)} />
          <span>Allow overlap with earlier pockets</span>
        </label>
      </div>
    </details>
    <details>
      <summary>Reference and dimensions</summary>
      <div className="ai-template-reference" hidden={shape === "contour"}>
        <p className="ai-template-note">{references.length ? "Use a reference body's bounding dimensions as an envelope." : "No visible reference bodies. Enter measured dimensions above."}</p>
        {references.map(body => <button key={body.id} type="button" disabled={disabled} aria-pressed={String(pocket.referenceBodyId === body.id)}
          onClick={() => { onReference(body); widthRef.current.focus(); }}>{body.name}</button>)}
      </div>
      <div className="ai-template-group">
        <span>Dimension evidence</span>
        {choices("Dimension evidence", EVIDENCE, pocket.evidenceKind, "evidenceKind")}
        <span>Original source units. Pocket dimensions are always entered in millimetres.</span>
        {choices("Original dimension units", ["mm", "cm", "in"].map(units => [units, units]), pocket.sourceUnits, "sourceUnits")}
        {text("product", "Item / model variant", "text", 160)}
        {text("url", "Dimension source URL (optional)", "url", 2000)}
      </div>
    </details>
  </section>;
}
