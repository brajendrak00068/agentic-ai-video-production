---
name: shaderfx-effects
description: "Write your own GPU effects for Levea in WGSL (ShaderFX ABI v2): filters that read and rewrite the footage, transitions that read clip A and clip B, and generators like light leaks, with real alpha, typed reusable parameters, server-side validation with line/column errors, and an effect library. The same shader runs in the WebGPU preview and the Vulkan export."
version: 1.0.0
author: brajendrak00068
license: MIT
---

# ShaderFX: custom GPU filters, transitions and generators (ABI v2)

ShaderFX lets an agent write a small WGSL function, `fx(c: FxCtx) -> vec4<f32>`, and run it on the GPU as part of a Levea edit. The server wraps it in a harness (bindings, helpers, output handling), validates it with naga before anything is saved or rendered, and the WebGPU preview and the Vulkan export compile the same wrapped shader with the same bindings, so what `render_preview` shows is what the export renders.

Use a built-in effect first when one fits: `search_tools` with `catalog: "vfx"` (328+ GPU effects) or `catalog: "transitions"` (~170). Write a ShaderFX effect when the look you need does not exist, when it has to read the footage in a specific way, or when you want a reusable house effect with its own parameters.

## Setup

This skill calls the Levea (livecore.ai) editing service, which requires a Levea account and API key.

1. Sign up and generate an API key at https://livecore.ai/?openclaw=1&utm_source=clawhub&utm_medium=skill&utm_campaign=shaderfx-effects
2. Provide the key to the tool you use:
   - MCP server `levea-mcp-server` (npm): set `LEVEA_API_KEY` in the MCP server config. `LEVEA_API_URL` is optional and defaults to `https://api.livecore.ai`.
   - Hosted MCP (`https://api.livecore.ai/api/v1/misc/mcp`): OAuth, no key needed.
   - OpenClaw plugin `openclaw-ai-video-editor` (ClawHub): set `apiKey` in the plugin config.

## Tools

| MCP tool | Canonical action (also callable via `execute_action` / `execute_batch`) | What it does |
|---|---|---|
| `create_shader_effect` | `CREATE_SHADER_EFFECT { name, source, manifest }` | Validates and saves an effect to your library; returns its id, or `errors: [{ line, column, message }]` and saves nothing |
| `list_shader_effects` | `LIST_SHADER_EFFECTS` | Your saved effects |
| (via `execute_action`) | `GET_SHADER_EFFECT { effect_id }` | One effect with its source and manifest |
| `apply_shader_effect` | `APPLY_SHADER_EFFECT { effect_id \| source+manifest, kind, target_layer_id \| from_layer_id+to_layer_id, params, start_time, end_time, output }` | Puts the effect on a project |
| `delete_shader_effect` | `DELETE_SHADER_EFFECT { effect_id }` | Removes it from the library (layers already using it keep their copy) |

The old path still works: `APPLY_VFX` / `TRANSITION` with `custom_shader_frag` is ABI v1 (`evaluate_pixel(uv, time, res, progress, intensity)`, no picture input, light-only output). Use ABI v2 for anything new.

### Workflow

1. Write `source` + `manifest`. Call `create_shader_effect`.
2. If it returns `errors`, fix those lines (they are numbered in YOUR source, not the wrapped shader) and call again.
3. `apply_shader_effect` with the returned `effect_id`, the `kind`, the layers, the time window and `params`.
4. `render_preview` at 2-4 timestamps inside the window (for a transition: start, middle, end) and look at the frames. Adjust `params` or the source and re-apply.
5. Export with `execute_action` `EXPORT_VIDEO`.

You can skip the library and pass `source` + `manifest` straight to `apply_shader_effect` (validated the same way) for one-off effects.

```json
{
  "project_id": "proj_123",
  "effect_id": "fx_abc",
  "kind": "transition",
  "from_layer_id": "clip_1",
  "to_layer_id": "clip_2",
  "start_time": 4.5,
  "end_time": 5.3,
  "params": { "strength": 0.7 }
}
```

## The author contract

### What you write

```wgsl
fn fx(c: FxCtx) -> vec4<f32> {
    // return STRAIGHT (non-premultiplied) rgba
}
```

You may add your own helper functions and `const`s above `fx`. Do not declare bindings, `@fragment`, `fs_main`, or anything named like the harness symbols below; the server builds those.

### FxCtx

| field | type | meaning |
|---|---|---|
| `uv` | `vec2<f32>` | 0..1 across the whole canvas, top-left origin (y grows downward) |
| `px` | `vec2<f32>` | pixel position, `uv * res` |
| `res` | `vec2<f32>` | canvas size in pixels |
| `time` | `f32` | timeline seconds |
| `local_time` | `f32` | seconds since this layer started |
| `progress` | `f32` | 0..1: transition progress for a transition, layer progress otherwise |
| `intensity` | `f32` | the layer's effect intensity; multiply your strength by it |

Aspect-correct anything round: `var p = c.uv - vec2<f32>(0.5, 0.5); p.x = p.x * (c.res.x / c.res.y);`

### Pictures you can read (all in canvas space, straight rgba)

| helper | filter | transition | generator |
|---|---|---|---|
| `src(uv)` | the target layer (`target_layer_id`) rendered alone, transparent elsewhere; without a target, everything composited below this layer | clip A | transparent |
| `backdrop(uv)` | everything composited below this layer this frame | same | same |
| `clip_a(uv)` | — | outgoing clip (`from_layer_id`) | — |
| `clip_b(uv)` | transparent | incoming clip (`to_layer_id`) | transparent |

Pictures are full-canvas and the same resolution as the output, so `src(c.uv)` is exactly the pixel under the fragment; offset the uv to displace, blur or split. Sampling is linear with clamp-to-edge, so uvs outside 0..1 repeat the edge pixel; mask them yourself if you need transparency there.

### Other helpers

| helper | signature | notes |
|---|---|---|
| `param` | `param(i: u32) -> f32` | raw parameter slot i (0..31) |
| `param_color` | `param_color(i: u32) -> vec4<f32>` | 4 consecutive slots from i |
| `P_<name>` | `P_strength()` … | generated per manifest param: `float` → `f32`, `vec2` → `vec2<f32>`, `vec3` → `vec3<f32>`, `color` → `vec4<f32>` (rgba). Prefer these over indices |
| `hash2` | `hash2(p: vec2<f32>) -> f32` | white noise in 0..1 |
| `noise2` | `noise2(p: vec2<f32>) -> f32` | smooth gradient noise, signed (about -0.5..0.5); add 0.5 for 0..1 |
| `fbm` | `fbm(p: vec2<f32>) -> f32` | 4 octaves of `noise2`, also signed |
| `luma` | `luma(rgb: vec3<f32>) -> f32` | perceived brightness |
| `rotate2` | `rotate2(v: vec2<f32>, angle: f32) -> vec2<f32>` | rotate by radians |

A `bool` param is one slot holding 0 or 1; test it as `param(i) > 0.5`.

### Output modes (`manifest.output`, or `output` on apply)

The harness turns your straight rgba into premultiplied "over" compositing:

- `normal` (default): your rgba is composited over what is below, with real alpha. Alpha 1 black is black: vignettes, shadows, letterboxes, darkening and full re-renders of a layer all work. For filters that rewrite a picture, return the picture's own alpha (`src(uv).a`) so the area outside the layer stays untouched.
- `add`: your rgb is added onto what is below and alpha is ignored (light only). Glows, leaks, sparks, flares. Fade it by scaling rgb, not alpha.
- `replace`: your rgb replaces what is below with alpha forced to 1, over the whole canvas. Use it for transitions between full-frame clips and for generators that paint every pixel. Do not use it for a filter on a layer that does not cover the frame: the transparent area outside the layer would turn black.

### Manifest and parameter slots

```json
{ "abi": 2, "kind": "filter", "output": "normal",
  "params": [ { "name": "strength", "type": "float", "min": 0, "max": 1, "default": 0.5 },
              { "name": "tint", "type": "color", "default": "#ffcc66" },
              { "name": "direction", "type": "vec2", "default": [1, 0] } ] }
```

- `kind`: `filter` | `transition` | `generator`. `output`: `add` | `normal` | `replace`.
- Slot sizes: `float` 1, `bool` 1, `vec2` 2, `vec3` 4, `color` 4 (rgba).
- Slots are assigned in declaration order. A `color` starts on the next multiple of 4, leaving a gap. Above: `strength` → 0, slots 1-3 unused, `tint` → 4-7, `direction` → 8-9. Declaring 4-slot params first avoids gaps.
- Total ≤ 32 slots.
- Names become accessors (`P_strength()`, `P_tint()`, `P_direction()`): use letters, digits and underscores only.
- Values are static per layer, or keyframed per slot (`fx_param_0` … `fx_param_31`); `apply_shader_effect` `params` takes values by name.

### Validation and limits

- The wrapped shader is compiled with naga before saving or rendering. Errors come back as `{ line, column, message }` in your own source lines.
- Author source ≤ 24 KB.
- Keep every loop bounded by a constant (`for (var i = 0; i < 8; i = i + 1)`). A layer whose pipeline fails to build or that stalls the GPU is skipped (picture unchanged) and reported.
- The same WGSL runs in preview and export: no renderer-specific code.

### WGSL pitfalls that fail validation

- Float literals: `1.0`, not `1`, in float math. `let k = 1;` is an `i32` and `k * 0.5` will not compile. Convert with `f32(i)`.
- Vector constructors need the type: `vec2<f32>(0.5, 0.5)`, `vec3<f32>(1.0)` (a single value splats), `vec4<f32>(rgb, a)`.
- `let` is immutable; use `var` for anything you assign to (including swizzle writes like `p.x = ...`).
- There is no `?:`; use `select(if_false, if_true, cond)` or `mix`/`step`.
- No recursion, no implicit conversions between `i32`, `u32` and `f32`; `param(2u)` takes a `u32`.
- Call `src` / `backdrop` / `clip_a` / `clip_b` unconditionally (not inside an `if` or a loop whose condition depends on pixel values); branch on the result instead. Texture sampling in non-uniform control flow fails validation.
- `smoothstep(e0, e1, x)` needs `e0 < e1`.

## Examples

Each example is complete: `source` is what you pass to `create_shader_effect` / `apply_shader_effect`, together with its manifest.

### 1. Filter: chromatic split + barrel distortion of the footage

Manifest: `{ "abi": 2, "kind": "filter", "output": "normal", "params": [] }`. Apply with `target_layer_id` to treat one clip, or without it to treat everything below.

```wgsl
// Barrel-distort uv around the centre, aspect-correct. Corners stay on corners,
// so the frame is never pulled in from the edges.
fn barrel(uv: vec2<f32>, k: f32, aspect: f32) -> vec2<f32> {
    var p = uv * 2.0 - 1.0;
    p.x = p.x * aspect;
    let r2 = dot(p, p);
    let corner_r2 = aspect * aspect + 1.0;
    p = p * (1.0 + k * r2) / (1.0 + k * corner_r2);
    p.x = p.x / aspect;
    return p * 0.5 + 0.5;
}

fn fx(c: FxCtx) -> vec4<f32> {
    let aspect = c.res.x / c.res.y;
    let k = 0.18 * c.intensity;
    let uv = barrel(c.uv, k, aspect);

    // Radial RGB split, strongest at the edges, breathing slowly.
    let dir = uv - vec2<f32>(0.5, 0.5);
    let split = (0.012 + 0.004 * sin(c.time * 2.0)) * c.intensity;
    let r = src(uv + dir * split);
    let g = src(uv);
    let b = src(uv - dir * split);

    let alpha = max(r.a, max(g.a, b.a));
    return vec4<f32>(r.r, g.g, b.b, alpha);
}
```

### 2. Filter: dark cinematic vignette with real alpha

Manifest: `{ "abi": 2, "kind": "filter", "output": "normal", "params": [] }`. Apply without `target_layer_id`, above the footage. It only paints near-black with alpha, so it darkens (impossible with ABI v1's light-only output).

```wgsl
fn fx(c: FxCtx) -> vec4<f32> {
    let aspect = c.res.x / c.res.y;
    var p = c.uv - vec2<f32>(0.5, 0.5);
    p.x = p.x * aspect;
    // 0 at the centre, 1 at the corners.
    let d = length(p) / length(vec2<f32>(0.5 * aspect, 0.5));
    let falloff = smoothstep(0.35, 1.05, d);

    // A touch of animated grain in the dark area breaks up banding.
    let grain = (hash2(floor(c.px) + vec2<f32>(c.time * 61.0, c.time * 17.0)) - 0.5) * 0.06;
    let alpha = clamp((falloff * 0.9 + grain * falloff) * c.intensity, 0.0, 1.0);

    // Slightly cool shadow colour reads as a lens, not a black overlay.
    return vec4<f32>(0.01, 0.012, 0.02, alpha);
}
```

### 3. Transition: displacement morph A→B driven by progress and noise

Manifest: `{ "abi": 2, "kind": "transition", "output": "replace", "params": [] }`. Apply with `from_layer_id` + `to_layer_id`; 0.6-1.0 s works well.

```wgsl
fn fx(c: FxCtx) -> vec4<f32> {
    let t = smoothstep(0.0, 1.0, c.progress);
    let aspect = c.res.x / c.res.y;
    let q = vec2<f32>(c.uv.x * aspect, c.uv.y) * 3.0;

    // A flowing 2D noise field used as the displacement direction.
    let n = vec2<f32>(
        fbm(q + vec2<f32>(c.time * 0.4, 0.0)),
        fbm(q + vec2<f32>(17.3, 9.1) - vec2<f32>(0.0, c.time * 0.4))
    );
    let amount = 0.25 * c.intensity;

    // A is pushed away as t grows; B settles in from the opposite push.
    // At t = 0 A is untouched, at t = 1 B is untouched.
    let a = clip_a(c.uv + n * amount * t);
    let b = clip_b(c.uv - n * amount * (1.0 - t));

    // Noise-dependent local progress: some areas morph earlier than others.
    let key = clamp(n.x + 0.5, 0.0, 1.0);
    let m = smoothstep(0.0, 1.0, clamp(t * 1.6 - key * 0.6, 0.0, 1.0));
    return mix(a, b, m);
}
```

### 4. Transition: ink-bleed wipe using the luma of clip B

Manifest: `{ "abi": 2, "kind": "transition", "output": "replace", "params": [] }`. Bright areas of the incoming shot bleed in first, with a ragged dark ink edge.

```wgsl
fn fx(c: FxCtx) -> vec4<f32> {
    let t = c.progress;
    let a = clip_a(c.uv);
    let b = clip_b(c.uv);

    // Reveal order: bright parts of B first, with fbm making the edge ragged.
    let ink = fbm(c.uv * 7.0 + vec2<f32>(0.0, t * 1.5)) + 0.5;
    let key = clamp((1.0 - luma(b.rgb)) * 0.7 + ink * 0.3, 0.0, 1.0);

    // Sweep a soft threshold from below 0 to above 1 so both ends are exact.
    let soft = 0.08;
    let sweep = t * (1.0 + 2.0 * soft) - soft;
    let m = smoothstep(key - soft, key + soft, sweep);

    // Dark ink rim where the two shots meet.
    let rim = 1.0 - abs(m * 2.0 - 1.0);
    let col = mix(a, b, m);
    let shade = 1.0 - 0.65 * rim * c.intensity;
    return vec4<f32>(col.rgb * shade, 1.0);
}
```

### 5. Generator: animated light leaks

Manifest: `{ "abi": 2, "kind": "generator", "output": "add", "params": [] }`. Apply with `start_time` / `end_time` over the section; it fades itself in and out with layer progress.

```wgsl
fn blob(p: vec2<f32>, centre: vec2<f32>, radius: vec2<f32>) -> f32 {
    let d = (p - centre) / radius;
    return exp(-dot(d, d));
}

fn fx(c: FxCtx) -> vec4<f32> {
    let t = c.local_time;
    let aspect = c.res.x / c.res.y;
    let p = vec2<f32>(c.uv.x * aspect, c.uv.y);

    // Slow drifting warp so the leaks feel like light through glass.
    let warp = fbm(p * 1.5 + vec2<f32>(t * 0.12, -t * 0.08));

    let c1 = vec2<f32>(aspect * (0.10 + 0.20 * sin(t * 0.35)), 0.15 + 0.12 * cos(t * 0.27));
    let c2 = vec2<f32>(aspect * (0.90 + 0.15 * cos(t * 0.22 + 1.3)), 0.80 + 0.15 * sin(t * 0.31 + 0.7));
    let l1 = blob(p + warp * 0.20, c1, vec2<f32>(0.55, 0.35));
    let l2 = blob(p - warp * 0.15, c2, vec2<f32>(0.45, 0.30));

    let warm = vec3<f32>(1.0, 0.42, 0.12);
    let gold = vec3<f32>(1.0, 0.78, 0.35);
    let flicker = 0.85 + 0.3 * noise2(vec2<f32>(t * 3.0, 0.0));
    let fade = smoothstep(0.0, 0.15, c.progress) * (1.0 - smoothstep(0.85, 1.0, c.progress));

    let light = (warm * l1 + gold * l2 * 0.8) * flicker * fade * c.intensity;
    return vec4<f32>(light, 1.0);
}
```

### 6. Parameterized reusable effect: tinted directional streak

Manifest (save once with `create_shader_effect`, then re-apply anywhere with different `params`):

```json
{ "abi": 2, "kind": "filter", "output": "normal",
  "params": [ { "name": "strength", "type": "float", "min": 0, "max": 1, "default": 0.5 },
              { "name": "tint", "type": "color", "default": "#ffcc66" },
              { "name": "direction", "type": "vec2", "default": [1, 0] } ] }
```

```wgsl
fn fx(c: FxCtx) -> vec4<f32> {
    let s = P_strength() * c.intensity;
    let tint = P_tint();                       // rgba; tint.a scales how much tint is used
    let dir_raw = P_direction();
    let dir = dir_raw / max(length(dir_raw), 0.0001);
    let aspect = c.res.x / c.res.y;
    let step_uv = vec2<f32>(dir.x / aspect, dir.y) * 0.04 * s;

    // Directional streak: 9 taps along the direction (constant loop bound).
    let base = src(c.uv);
    var acc = vec4<f32>(0.0);
    for (var i = 0; i < 9; i = i + 1) {
        let o = f32(i) / 8.0 - 0.5;
        acc = acc + src(c.uv + step_uv * o);
    }
    acc = acc / 9.0;

    // Highlights streak and pick up the tint; shadows stay put.
    let hi = smoothstep(0.45, 1.0, luma(acc.rgb));
    let streak = mix(base.rgb, acc.rgb, s);
    let tinted = mix(streak, streak * tint.rgb * 1.3, hi * tint.a * s);

    // A soft wash along the direction ties the frame together.
    let along = clamp(dot(c.uv - vec2<f32>(0.5, 0.5), dir) + 0.5, 0.0, 1.0);
    let wash = tint.rgb * along * 0.12 * s;

    return vec4<f32>(clamp(tinted + wash, vec3<f32>(0.0), vec3<f32>(1.0)), base.a);
}
```

The same effect with raw slots (what the accessors expand to with this manifest): `P_strength()` = `param(0u)`, `P_tint()` = `param_color(4u)`, `P_direction()` = `vec2<f32>(param(8u), param(9u))`.

Apply it twice with different looks:

```json
{ "project_id": "proj_123", "effect_id": "fx_streak", "kind": "filter", "target_layer_id": "@primary",
  "start_time": 0, "end_time": 3, "params": { "strength": 0.8, "tint": "#66ccff", "direction": [0, 1] } }
```

## Quality checklist

- Every frame of the window looks right in `render_preview`, not just the middle one. For transitions check progress 0, 0.5 and 1: the ends must match clip A and clip B exactly.
- Strength scales with `c.intensity`, so the effect can be dialled down without editing source.
- Round things are aspect-corrected; the effect looks the same in 9:16 and 16:9.
- Filters that rewrite a layer return `src(uv).a`; only full-frame work uses `replace`.
- Light-only looks use `add`; anything that darkens uses `normal` with alpha.
- Time-based motion uses `local_time` (starts at 0 with the layer) unless it must stay in sync with the timeline.
