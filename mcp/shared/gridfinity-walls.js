export const BIN_SIDES = Object.freeze(["left", "right", "front", "back"]);

export function normalizeFingerScoopSlope(value, side) {
  if (value === undefined) return undefined;
  if (!side || value !== 1 && value !== 2) throw new Error("Finger scoop slope must be 1 or 2 on an enabled scoop.");
  return value;
}
export function normalizeFingerScoop(side, kind, openSides) {
  if (side === undefined) return undefined;
  if (kind !== "bin" || !BIN_SIDES.includes(side) || openSides.includes(side)) {
    throw new Error("Finger scoop requires a closed wall on a storage bin.");
  }
  return side;
}

export function normalizeOpenSides(value, label = "openSides") {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > BIN_SIDES.length || value.some(side => !BIN_SIDES.includes(side)) || new Set(value).size !== value.length) {
    throw new Error(`${label} must list unique sides: left, right, front or back.`);
  }
  return BIN_SIDES.filter(side => value.includes(side));
}

export function rotateOpenSides(value) {
  const clockwise = { left: "back", back: "right", right: "front", front: "left" };
  return normalizeOpenSides(normalizeOpenSides(value).map(side => clockwise[side]));
}

export function binTotalHeight({ heightUnits, floor, lip, openSides, dividers = {} }) {
  if (normalizeOpenSides(openSides).length === 4) return dividers.x || dividers.y ? heightUnits * 7 - 0.01 : 7 + floor;
  return heightUnits * 7 + (lip ? 4.4 : 0);
}

export function normalizeCloseGaps(value, sides, kind = "bin") {
  if (value !== undefined && typeof value !== "boolean") throw new Error("closeGaps must be a boolean.");
  if (value && (kind !== "bin" || !normalizeOpenSides(sides).length)) throw new Error("closeGaps requires a bin with at least one open side.");
  return value === true;
}

// The body from the foot tops upward reaches these grid-boundary edges.
export function binFootprint({ columns, rows, closeGaps, openSides = [] }) {
  const extension = side => closeGaps && openSides.includes(side) ? 0.25 : 0;
  const left = extension("left"), right = extension("right"), front = extension("front"), back = extension("back");
  const width = columns * 42 - 0.5, depth = rows * 42 - 0.5;
  return { width: width + left + right, depth: depth + front + back,
    minX: -width / 2 - left, maxX: width / 2 + right, minY: -depth / 2 - front, maxY: depth / 2 + back };
}
