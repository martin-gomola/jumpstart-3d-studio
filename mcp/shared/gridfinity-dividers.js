const MIN_CLEARANCE = 2;

export function evenDividerPositions(dividers = {}) {
  const evenly = count => Array.from({ length: count }, (_, index) => (index + 1) / (count + 1));
  return { x: evenly(dividers.x || 0), y: evenly(dividers.y || 0) };
}

export function normalizeDividerPositions(raw, dividers, width, depth, wall, label = "dividerPositions") {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !["x", "y"].includes(key))) {
    throw new Error(`${label} must contain only x and y arrays`);
  }
  const normalizeAxis = (axis, span) => {
    const count = dividers[axis] || 0;
    const values = raw[axis] ?? evenDividerPositions({ [axis]: count })[axis];
    if (!Array.isArray(values) || values.length !== count) throw new Error(`${label}.${axis} must contain one position per divider`);
    const result = values.map((value, index) => {
      if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${label}.${axis}[${index}] must be between 0 and 1`);
      if (index && value <= values[index - 1]) throw new Error(`${label}.${axis} positions must increase from the inside wall`);
      return value;
    });
    const bounds = [0, ...result, 1];
    for (let index = 0; index < bounds.length - 1; index++) {
      const edgeAllowance = index === 0 || index === bounds.length - 2 ? wall / 2 : wall;
      if ((bounds[index + 1] - bounds[index]) * span - edgeAllowance < MIN_CLEARANCE - 1e-7) {
        throw new Error(`${label}.${axis} leaves less than ${MIN_CLEARANCE} mm in a compartment`);
      }
    }
    return result;
  };
  const innerWidth = width - 2 * wall, innerDepth = depth - 2 * wall;
  if (innerWidth <= 0 || innerDepth <= 0) throw new Error(`${label} needs a positive inside area`);
  return { x: normalizeAxis("x", innerWidth), y: normalizeAxis("y", innerDepth) };
}

export function rotateDividerPositions(positions) {
  if (!positions) return undefined;
  return { x: [...positions.y], y: positions.x.map(position => 1 - position).sort((a, b) => a - b) };
}
