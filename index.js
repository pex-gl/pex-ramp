// Serializable values. Handles are absolute [position, value] coordinates.
const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const pair = (v) =>
  Array.isArray(v) && v.length === 2 && Array.from(v).every(unit);
const ordered = (items, fixedEndpoints = true) =>
  Array.isArray(items) &&
  items.length >= 2 &&
  (!fixedEndpoints ||
    (items[0]?.position === 0 && items.at(-1)?.position === 1)) &&
  Array.from(items).every(
    (p, i) => unit(p?.position) && (!i || p.position > items[i - 1].position),
  );

export function isRamp(value) {
  return !!(
    value?.type === "ramp" &&
    value.version === 1 &&
    ["linear", "bezier"].includes(value.interpolation) &&
    ordered(value.points) &&
    value.points.every(
      (p, i, points) =>
        unit(p.value) &&
        (p.handleMode === undefined ||
          ["smooth", "symmetric", "corner"].includes(p.handleMode)) &&
        (p.in === undefined ||
          (pair(p.in) &&
            p.in[0] <= p.position &&
            p.in[0] >= (points[i - 1]?.position ?? 0))) &&
        (p.out === undefined ||
          (pair(p.out) &&
            p.out[0] >= p.position &&
            p.out[0] <= (points[i + 1]?.position ?? 1))),
    )
  );
}

export function isGradient(value) {
  return !!(
    value?.type === "gradient" &&
    value.version === 1 &&
    ["linear", "smooth", "step"].includes(value.interpolation) &&
    (value.colorSpace === undefined ||
      ["srgb", "linear", "oklab"].includes(value.colorSpace)) &&
    ordered(value.stops, false) &&
    value.stops.every(
      (s) =>
        Array.isArray(s.color) &&
        s.color.length === 4 &&
        Array.from(s.color).every(unit),
    )
  );
}

export function createRamp() {
  return {
    type: "ramp",
    version: 1,
    interpolation: "bezier",
    points: [
      { position: 0, value: 0, handleMode: "smooth", out: [1 / 3, 0] },
      { position: 1, value: 1, handleMode: "smooth", in: [2 / 3, 1] },
    ],
  };
}

export function createGradient() {
  return {
    type: "gradient",
    version: 1,
    interpolation: "smooth",
    colorSpace: "oklab",
    stops: [
      { position: 0, color: [0, 0, 0, 1] },
      { position: 1, color: [1, 1, 1, 1] },
    ],
  };
}

function segment(items, t) {
  // Upper bound: exact knots belong to the segment on their right.
  let low = 0,
    high = items.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (items[mid].position <= t) low = mid;
    else high = mid;
  }
  return low;
}
const mix = (a, b, t) => a + (b - a) * t;
const mix2 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
const cubic = (a, b, c, d, t) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};

export function rampSegment(a, b) {
  const start = [a.position, a.value],
    end = [b.position, b.value];
  return [
    start,
    a.out || mix2(start, end, 1 / 3),
    b.in || mix2(start, end, 2 / 3),
    end,
  ];
}

function parameterAtX(p, x) {
  // Solve x(u)=t, not y(t). Bisection also handles vertical endpoint tangents.
  let low = 0,
    high = 1;
  for (let i = 0; i < 40; i++) {
    const u = (low + high) / 2;
    if (cubic(p[0][0], p[1][0], p[2][0], p[3][0], u) < x) low = u;
    else high = u;
  }
  return (low + high) / 2;
}

// Hot-path samplers expect valid values. Validate external JSON once with isRamp/isGradient.
export function sampleRamp(ramp, t) {
  if (!Number.isFinite(t)) throw new RangeError("Ramp t must be finite");
  t = clamp(t);
  const i = segment(ramp.points, t);
  const a = ramp.points[i];
  const b = ramp.points[i + 1];
  if (t === a.position) return a.value;
  if (t === b.position) return b.value;
  if (ramp.interpolation === "linear")
    return mix(a.value, b.value, (t - a.position) / (b.position - a.position));
  const p = rampSegment(a, b),
    u = parameterAtX(p, t);
  return cubic(p[0][1], p[1][1], p[2][1], p[3][1], u);
}

const srgbToLinear = (v) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (v) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

function linearRgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function colorToSpace(color, colorSpace) {
  if (colorSpace === "srgb") return color.slice(0, 3);
  const linear = color.slice(0, 3).map(srgbToLinear);
  return colorSpace === "oklab" ? linearRgbToOklab(linear) : linear;
}

function colorFromSpace(color, colorSpace) {
  if (colorSpace === "srgb") return color.map((value) => clamp(value));
  const linear = colorSpace === "oklab" ? oklabToLinearRgb(color) : color;
  return linear.map((v) => clamp(linearToSrgb(v)));
}

function monotoneSlope(stops, values, i) {
  const last = stops.length - 1;
  if (i === 0)
    return (values[1] - values[0]) / (stops[1].position - stops[0].position);
  if (i === last)
    return (
      (values[last] - values[last - 1]) /
      (stops[last].position - stops[last - 1].position)
    );
  const h0 = stops[i].position - stops[i - 1].position;
  const h1 = stops[i + 1].position - stops[i].position;
  const d0 = (values[i] - values[i - 1]) / h0;
  const d1 = (values[i + 1] - values[i]) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0;
  const w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

function smoothValue(stops, values, i, u) {
  const h = stops[i + 1].position - stops[i].position;
  const m0 = monotoneSlope(stops, values, i);
  const m1 = monotoneSlope(stops, values, i + 1);
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * values[i] +
    (u3 - 2 * u2 + u) * h * m0 +
    (-2 * u3 + 3 * u2) * values[i + 1] +
    (u3 - u2) * h * m1
  );
}

export function sampleGradient(gradient, t, out = [0, 0, 0, 0]) {
  if (!Number.isFinite(t)) throw new RangeError("Gradient t must be finite");
  t = clamp(t, gradient.stops[0].position, gradient.stops.at(-1).position);
  const i = segment(gradient.stops, t),
    a = gradient.stops[i],
    b = gradient.stops[i + 1];
  if (
    gradient.interpolation === "step" ||
    t === a.position ||
    t === b.position
  ) {
    // Hold the left stop until the next stop, including its alpha.
    const color = t === b.position ? b.color : a.color;
    for (let c = 0; c < 4; c++) out[c] = color[c];
    return out;
  }
  const u = (t - a.position) / (b.position - a.position);
  const colorSpace = gradient.colorSpace ?? "srgb";
  const colors = gradient.stops.map((stop) => [
    ...colorToSpace(stop.color, colorSpace),
    stop.color[3],
  ]);
  const mixed = new Array(4);
  for (let c = 0; c < 4; c++) {
    const values = colors.map((color) => color[c]);
    mixed[c] =
      gradient.interpolation === "smooth"
        ? smoothValue(gradient.stops, values, i, u)
        : mix(values[i], values[i + 1], u);
  }
  const rgb = colorFromSpace(mixed.slice(0, 3), colorSpace);
  for (let c = 0; c < 3; c++) out[c] = rgb[c];
  out[3] = clamp(mixed[3]);
  return out;
}

// Split with de Casteljau so inserting a point preserves the entire curve.
export function insertRampPoint(ramp, position) {
  const next = JSON.parse(JSON.stringify(ramp));
  if (
    !unit(position) ||
    position === 0 ||
    position === 1 ||
    next.points.some((p) => Math.abs(p.position - position) < 1e-6)
  )
    return next;
  const i = segment(next.points, position),
    a = next.points[i],
    b = next.points[i + 1];
  if (next.interpolation === "linear") {
    next.points.splice(i + 1, 0, {
      position,
      handleMode: "smooth",
      value: sampleRamp(ramp, position),
    });
  } else {
    const p = rampSegment(a, b),
      u = parameterAtX(p, position);
    const q = [mix2(p[0], p[1], u), mix2(p[1], p[2], u), mix2(p[2], p[3], u)];
    const r = [mix2(q[0], q[1], u), mix2(q[1], q[2], u)],
      s = mix2(r[0], r[1], u);
    a.out = q[0];
    b.in = q[2];
    // Subdivision changes one handle length at each neighbor. Preserve the
    // curve by retaining alignment without requiring equal lengths there.
    if (a.handleMode === "symmetric") a.handleMode = "smooth";
    if (b.handleMode === "symmetric") b.handleMode = "smooth";
    next.points.splice(i + 1, 0, {
      position,
      handleMode: "smooth",
      value: s[1],
      in: r[0],
      out: r[1],
    });
  }
  return next;
}

// Older definitions retain their independent handles until explicitly linked.
export const rampHandleMode = (point) => point.handleMode ?? "corner";

function handleAt(ramp, i, side) {
  const p = ramp.points[i];
  if (side === "in" && i > 0)
    return p.in || rampSegment(ramp.points[i - 1], p)[2];
  if (side === "out" && i < ramp.points.length - 1)
    return p.out || rampSegment(p, ramp.points[i + 1])[1];
  return [p.position, p.value];
}

// Shorten along the tangent at boundaries instead of clamping axes independently.
function fitHandle(ramp, i, side, vector) {
  const p = ramp.points[i];
  const xMin =
    side === "in" ? (ramp.points[i - 1]?.position ?? p.position) : p.position;
  const xMax =
    side === "out" ? (ramp.points[i + 1]?.position ?? p.position) : p.position;
  let scale = 1;
  for (const [d, min, max, origin] of [
    [vector[0], xMin, xMax, p.position],
    [vector[1], 0, 1, p.value],
  ]) {
    if (d > 0) scale = Math.min(scale, (max - origin) / d);
    if (d < 0) scale = Math.min(scale, (min - origin) / d);
  }
  scale = Math.max(0, scale);
  return [
    clamp(p.position + vector[0] * scale, xMin, xMax),
    clamp(p.value + vector[1] * scale),
  ];
}

function alignHandles(ramp, i, side = "out") {
  const p = ramp.points[i];
  const mode = rampHandleMode(p);
  if (mode === "corner" || i === 0 || i === ramp.points.length - 1) return;
  const other = side === "in" ? "out" : "in";
  const a = handleAt(ramp, i, side),
    b = handleAt(ramp, i, other);
  let dx = a[0] - p.position,
    dy = a[1] - p.value;
  const length = Math.hypot(dx, dy),
    otherLength = Math.hypot(b[0] - p.position, b[1] - p.value);
  if (length === 0) {
    dx = p.position - b[0];
    dy = p.value - b[1];
  }
  // At the normalized Y limits an interior smooth point must have a flat tangent.
  if (p.value === 0 || p.value === 1) {
    dx = side === "in" ? -1 : 1;
    dy = 0;
  }
  const directionLength = Math.hypot(dx, dy);
  if (!directionLength) return;
  dx /= directionLength;
  dy /= directionLength;
  const first = fitHandle(ramp, i, side, [dx * length, dy * length]);
  const secondLength = mode === "symmetric" ? length : otherLength;
  const second = fitHandle(ramp, i, other, [
    -dx * secondLength,
    -dy * secondLength,
  ]);
  if (mode === "symmetric") {
    const sharedLength = Math.min(
      Math.hypot(first[0] - p.position, first[1] - p.value),
      Math.hypot(second[0] - p.position, second[1] - p.value),
    );
    p[side] = fitHandle(ramp, i, side, [dx * sharedLength, dy * sharedLength]);
    p[other] = fitHandle(ramp, i, other, [
      -dx * sharedLength,
      -dy * sharedLength,
    ]);
  } else {
    p[side] = first;
    p[other] = second;
  }
}

// Editing helpers mutate an owned definition, like constrainRamp.
export function setRampHandle(
  ramp,
  i,
  side,
  position,
  { breakAlignment = false } = {},
) {
  const p = ramp.points[i];
  if (
    !["in", "out"].includes(side) ||
    !Array.isArray(position) ||
    position.length !== 2 ||
    !position.every(Number.isFinite)
  )
    throw new TypeError(
      "A ramp handle needs a side and two finite coordinates",
    );
  if (breakAlignment) p.handleMode = "corner";
  const other = side === "in" ? "out" : "in";
  if (i > 0 && i < ramp.points.length - 1 && rampHandleMode(p) !== "corner")
    p[other] = [...handleAt(ramp, i, other)];
  p[side] = [
    clamp(
      position[0],
      side === "in" ? (ramp.points[i - 1]?.position ?? p.position) : p.position,
      side === "out"
        ? (ramp.points[i + 1]?.position ?? p.position)
        : p.position,
    ),
    clamp(position[1]),
  ];
  alignHandles(ramp, i, side);
  return ramp;
}

export function setRampHandleMode(ramp, i, mode) {
  if (!["smooth", "symmetric", "corner"].includes(mode))
    throw new TypeError("Unknown ramp handle mode");
  ramp.points[i].handleMode = mode;
  alignHandles(ramp, i);
  return ramp;
}

// Constrain handles after moving knots; linked handles retain their common tangent.
export function constrainRamp(ramp) {
  ramp.points.forEach((p, i, points) => {
    if (rampHandleMode(p) !== "corner" && i > 0 && i < points.length - 1) {
      alignHandles(ramp, i);
      return;
    }
    if (p.in)
      p.in = [
        clamp(p.in[0], points[i - 1]?.position ?? p.position, p.position),
        clamp(p.in[1]),
      ];
    if (p.out)
      p.out = [
        clamp(p.out[0], p.position, points[i + 1]?.position ?? p.position),
        clamp(p.out[1]),
      ];
  });
  return ramp;
}
