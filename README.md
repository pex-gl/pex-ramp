# pex-ramp

Create and sample numeric ramps and RGBA color gradients. Ramps and gradients are plain, JSON-serializable objects.

```js
import {
  createRamp,
  createGradient,
  sampleRamp,
  sampleGradient,
} from "pex-ramp";

const ramp = createRamp();
const gradient = createGradient();

const value = sampleRamp(ramp, 0.5); // Approximately 0.5
const color = sampleGradient(gradient, 0.5); // [r, g, b, a]
```

## createRamp()

Returns a new numeric ramp with a smooth Bézier transition from 0 to 1. Takes no arguments; each call creates independent points and handles.

```js
const ramp = createRamp();
// {
//   type: "ramp",
//   version: 1,
//   interpolation: "bezier",
//   points: [
//     { position: 0, value: 0, handleMode: "smooth", out: [1 / 3, 0] },
//     { position: 1, value: 1, handleMode: "smooth", in: [2 / 3, 1] },
//   ],
// }
```

Set `interpolation` to `"linear"` for straight segments or `"bezier"` for cubic Bézier segments. Handles use absolute `[position, value]` coordinates, not offsets. Missing handles default to one third of the straight segment from the corresponding endpoint.

A ramp requires at least two points with strictly increasing positions in `[0, 1]`, starting at 0 and ending at 1. Values and handle coordinates are also in `[0, 1]`; handles stay within their adjacent segment's position range.

## createGradient()

Returns a new opaque black-to-white gradient. Takes no arguments; each call creates independent stops and colors.

```js
const gradient = createGradient();
// {
//   type: "gradient",
//   version: 1,
//   interpolation: "smooth",
//   colorSpace: "oklab",
//   stops: [
//     { position: 0, color: [0, 0, 0, 1] },
//     { position: 1, color: [1, 1, 1, 1] },
//   ],
// }
```

Each stop has a `position` and an sRGB `color` array `[r, g, b, a]`, with all components in `[0, 1]`. A gradient requires at least two stops with strictly increasing positions in `[0, 1]`. The first and last stops can be anywhere within that range; their colors extend outward.

| `interpolation` | Behavior |
| --- | --- |
| `"linear"` | Straight interpolation between adjacent stops. |
| `"smooth"` | Monotone cubic interpolation per channel in the selected color space. |
| `"step"` | Hold each stop's color until the next stop, then switch immediately. |

| `colorSpace` | RGB interpolation space |
| --- | --- |
| `"oklab"` | Oklab; the default for new gradients. |
| `"srgb"` | Interpolate encoded sRGB components directly. Also used when `colorSpace` is omitted. |
| `"linear"` | Convert sRGB to linear RGB before interpolation. |

Input and output RGB values remain sRGB regardless of the interpolation space. Alpha is interpolated separately, without premultiplying RGB. Step mode copies the stop color directly, regardless of color space.

## sampleRamp(ramp, t)

Returns the numeric value of `ramp` at position `t` without modifying the ramp.

| Parameter | Description |
| --- | --- |
| `ramp` | A valid ramp object. |
| `t` | Finite numeric position, clamped to `[0, 1]`. |

For Bézier ramps, `t` is the horizontal position on the curve, not the Bézier parameter. The sampler solves for that position before evaluating the value.

```js
const ramp = createRamp();
ramp.interpolation = "linear";
ramp.points = [
  { position: 0, value: 0 },
  { position: 0.5, value: 1 },
  { position: 1, value: 0 },
];

sampleRamp(ramp, 0.25); // 0.5
sampleRamp(ramp, 0.5); // 1
sampleRamp(ramp, 2); // 0 (last point)
```

Throws `RangeError` if `t` is not finite, including `NaN` and infinities. The ramp structure is expected to be valid and is not validated during sampling.

## sampleGradient(gradient, t, out?)

Returns the RGBA color of `gradient` at position `t` without modifying the gradient. Before the first stop or after the last, returns that endpoint's color. At a stop's exact position, returns that stop's color.

| Parameter | Description |
| --- | --- |
| `gradient` | A valid gradient object. |
| `t` | Finite numeric position, usually in `[0, 1]`. |
| `out` | Optional writable array or floating-point typed array with room for four components. Written to and returned. Defaults to a new array. |

```js
const gradient = createGradient();
gradient.interpolation = "linear";
gradient.colorSpace = "srgb";
gradient.stops = [
  { position: 0, color: [1, 0, 0, 1] },
  { position: 1, color: [0, 0, 1, 0.5] },
];

sampleGradient(gradient, 0.5); // [0.5, 0, 0.5, 0.75]

const out = new Float32Array(4);
sampleGradient(gradient, 0.5, out); // Returns out
```

For three equally sized color zones, use step interpolation with stops at 0, 1/3, and 2/3. The final color extends to 1 and beyond. Uniformly distributed `t` values in `[0, 1]` then select each color with equal probability.

```js
const palette = createGradient();
palette.interpolation = "step";
palette.stops = [
  { position: 0, color: [1, 0, 0, 1] },
  { position: 1 / 3, color: [0, 1, 0, 1] },
  { position: 2 / 3, color: [0, 0, 1, 1] },
];

sampleGradient(palette, 0.2); // [1, 0, 0, 1]
sampleGradient(palette, 1 / 3); // [0, 1, 0, 1]
sampleGradient(palette, 0.9); // [0, 0, 1, 1]
```

Throws `RangeError` if `t` is not finite, including `NaN` and infinities. The gradient structure is expected to be valid and is not validated during sampling.
