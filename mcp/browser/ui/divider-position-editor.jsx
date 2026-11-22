import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { evenDividerPositions } from "../../shared/gridfinity-dividers.js";
import { NumberField } from "./controls.jsx";
import { numberValid } from "./field-text.js";

const dividerAxis = { x: { heading: "Across width", side: "left" }, y: { heading: "Along depth", side: "front" } };
const axisSpan = (bin, wall, axis) => (axis === "x" ? bin.columns : bin.rows) * 42 - 0.5 - 2 * wall;
function dividerBounds(values, index, span, wall) {
  const min = index === 0 ? wall / 2 + 2 : values[index - 1] * span + wall + 2;
  const max = index === values.length - 1 ? span - wall / 2 - 2 : values[index + 1] * span - wall - 2;
  // The minimum can land between tenths of a millimetre.
  return { min, max };
}

export function DividerPositionEditor({ id, message, bin, wall, disabled, onCommit, showEmptyPlan = false }) {
  const positions = bin.dividerPositions || evenDividerPositions(bin.dividers);
  const spans = { x: axisSpan(bin, wall, "x"), y: axisSpan(bin, wall, "y") };
  const viewHeight = 1000 * bin.rows / bin.columns;
  const svgInner = { startX: 80, sizeX: 840, endX: 920, startY: viewHeight * 0.08, sizeY: viewHeight * 0.84, endY: viewHeight * 0.92, midX: 500, midY: viewHeight / 2 };
  const scoopEdge = {
    front: [94, viewHeight * 0.93, 906, viewHeight * 0.93],
    back: [94, viewHeight * 0.07, 906, viewHeight * 0.07],
    left: [70, viewHeight * 0.07 + 24, 70, viewHeight * 0.93 - 24],
    right: [930, viewHeight * 0.07 + 24, 930, viewHeight * 0.93 - 24],
  }[bin.fingerScoop];
  const key = JSON.stringify([bin.id, bin.dividers, bin.dividerPositions, spans]);
  const [texts, setTexts] = useState(() => dividerTexts(positions, spans));
  const [touched, setTouched] = useState({}), [dragPreview, setDragPreview] = useState(null);
  const svgRef = useRef(null), dragRef = useRef(null);
  useLayoutEffect(() => { setTexts(dividerTexts(positions, spans)); setTouched({}); setDragPreview(null); }, [key]);
  const visible = dragPreview || positions;
  const commitText = (axis, index, text) => {
    const bounds = dividerBounds(positions[axis], index, spans[axis], wall);
    const valid = numberValid(text, bounds);
    setTouched(current => ({ ...current, [`${axis}-${index}`]: true }));
    if (!valid) return;
    const next = { x: [...positions.x], y: [...positions.y] };
    next[axis][index] = Number(text) / spans[axis];
    flushSync(() => onCommit(next));
  };
  const point = event => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!matrix) return null;
    const cursor = svg.createSVGPoint(); cursor.x = event.clientX; cursor.y = event.clientY;
    return cursor.matrixTransform(matrix.inverse());
  };
  const move = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cursor = point(event); if (!cursor) return;
    const raw = drag.axis === "x" ? (cursor.x - svgInner.startX) / svgInner.sizeX : (svgInner.endY - cursor.y) / svgInner.sizeY;
    const bounds = dividerBounds(drag.positions[drag.axis], drag.index, spans[drag.axis], wall);
    const normalized = Math.max(bounds.min / spans[drag.axis], Math.min(bounds.max / spans[drag.axis], raw));
    const next = { x: [...drag.positions.x], y: [...drag.positions.y] };
    next[drag.axis][drag.index] = normalized;
    drag.next = next; setDragPreview(next);
  };
  const beginDrag = (axis, index, event) => {
    if (disabled) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { axis, index, pointerId: event.pointerId, handle: event.currentTarget, positions: { x: [...positions.x], y: [...positions.y] }, next: positions };
  };
  const finishDrag = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    move(event);
    if (drag.handle.hasPointerCapture(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
    dragRef.current = null; setDragPreview(null);
    flushSync(() => onCommit(drag.next));
  };
  const cancelDrag = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.handle.hasPointerCapture(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
    dragRef.current = null; setDragPreview(null);
  };
  const adjust = (axis, index, event) => {
    const values = positions[axis], span = spans[axis], current = values[index] * span, bounds = dividerBounds(values, index, span, wall);
    let nextValue = current;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue -= event.shiftKey ? 5 : 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue += event.shiftKey ? 5 : 1;
    else if (event.key === "Home") nextValue = bounds.min;
    else if (event.key === "End") nextValue = bounds.max;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const next = { x: [...positions.x], y: [...positions.y] };
    next[axis][index] = Math.max(bounds.min, Math.min(bounds.max, nextValue)) / span;
    flushSync(() => onCommit(next));
  };
  const xCount = positions.x.length, yCount = positions.y.length;
  if (!xCount && !yCount && !showEmptyPlan && !scoopEdge) return <p className="ai-template-note">Set either compartment count above 1 to add a divider. New dividers start evenly spaced.</p>;
  const line = (axis, index) => {
    const values = visible[axis], position = values[index], bounds = dividerBounds(values, index, spans[axis], wall);
    const label = `${axis === "x" ? "Across width" : "Along depth"} divider ${index + 1}`;
    const x = axis === "x" ? svgInner.startX + position * svgInner.sizeX : svgInner.startX;
    const y = axis === "x" ? svgInner.startY : svgInner.endY - position * svgInner.sizeY;
    return <g key={`${axis}-${index}`} className="drawer-divider-handle" role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={label} aria-orientation={axis === "x" ? "horizontal" : "vertical"} aria-valuemin={bounds.min.toFixed(1)} aria-valuemax={bounds.max.toFixed(1)}
      aria-valuenow={(position * spans[axis]).toFixed(1)} aria-valuetext={`${(position * spans[axis]).toFixed(1)} mm from the ${dividerAxis[axis].side} inside wall`}
      onKeyDown={event => adjust(axis, index, event)} onPointerDown={event => beginDrag(axis, index, event)}>
      {axis === "x" ? <><rect className="drawer-divider-hit" x={x - 16} y={svgInner.startY} width="32" height={svgInner.sizeY} /><line className="drawer-divider-line" x1={x} y1={svgInner.startY} x2={x} y2={svgInner.endY} /><circle className="drawer-divider-knob" cx={x} cy={svgInner.midY} r="18" /></>
        : <><rect className="drawer-divider-hit" x={svgInner.startX} y={y - 16} width={svgInner.sizeX} height="32" /><line className="drawer-divider-line" x1={svgInner.startX} y1={y} x2={svgInner.endX} y2={y} /><circle className="drawer-divider-knob" cx={svgInner.midX} cy={y} r="18" /></>}
    </g>;
  };
  return <div className="drawer-divider-editor">
    <svg ref={svgRef} className="drawer-divider-diagram" viewBox={`0 0 1000 ${viewHeight}`} preserveAspectRatio="none" role="group"
      aria-label={`${bin.label || "Bin"} compartments from above. Front of bin is at the bottom.${scoopEdge ? ` Finger scoop wall: ${bin.fingerScoop}.` : ""}`} style={{ aspectRatio: `${bin.columns} / ${bin.rows}` }}
      onPointerMove={move} onPointerUp={finishDrag} onPointerCancel={cancelDrag}>
      <rect className="drawer-divider-outline" x="70" y={viewHeight * 0.07} width="860" height={viewHeight * 0.86} rx="24" />
      {scoopEdge && <line className="drawer-scoop-edge" x1={scoopEdge[0]} y1={scoopEdge[1]} x2={scoopEdge[2]} y2={scoopEdge[3]} />}
      {positions.x.map((_, index) => line("x", index))}
      {positions.y.map((_, index) => line("y", index))}
    </svg>
    <p id={`${id}-note`} className="ai-template-note">{xCount || yCount ? "Drag a divider or edit its distance from the inside wall. Front is at the bottom; each compartment needs at least 2 mm clear width." : "Set either compartment count above 1 to add a divider. New dividers start evenly spaced."}</p>
    <div className="drawer-divider-fields">
      {(["x", "y"]).map(axis => positions[axis].length > 0 && <section key={axis} className="drawer-divider-axis">
        <h4>{dividerAxis[axis].heading}</h4>
        <div className="ai-template-fields">
          {positions[axis].map((position, index) => {
            const bounds = dividerBounds(positions[axis], index, spans[axis], wall), field = `${axis}-${index}`;
            return <NumberField key={field} id={`${id}-${field}`} label={`Divider ${index + 1} from ${dividerAxis[axis].side} (mm)`}
              text={texts[field] ?? (position * spans[axis]).toFixed(1)} limits={bounds} describedBy={`${id}-note ${message}`} disabled={disabled}
              invalid={touched[field] ? !numberValid(texts[field], bounds) : undefined}
              onText={text => setTexts(current => ({ ...current, [field]: text }))}
              onEdit={text => setTouched(current => ({ ...current, [field]: !numberValid(text, bounds) }))}
              onCommit={text => commitText(axis, index, text)} />;
          })}
        </div>
      </section>)}
    </div>
  </div>;
}

function dividerTexts(positions, spans) {
  return Object.fromEntries(["x", "y"].flatMap(axis => positions[axis].map((position, index) => [`${axis}-${index}`, (position * spans[axis]).toFixed(1)])));
}
