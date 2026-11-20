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
| `create_shader_effect` | `CREATE_SHADER_EFFECT { name, source, manifest, description?, is_public?, overwrite? }` | Validates and saves an effect to your library; returns `effect_id` and the parameter table (name, type, slot, accessor), or `errors: [{ line, column, message }]` and saves nothing. `overwrite: true` replaces your effect of the same name |
| `list_shader_effects` | `LIST_SHADER_EFFECTS { include_public?, query?, limit? }` | Your saved effects (id, name, kind, output, params) |
| (via `execute_action`) | `GET_SHADER_EFFECT { effect_id }` | One effect with its source, manifest and parameter table |
| `apply_shader_effect` | `APPLY_SHADER_EFFECT` (fields below) | Adds a ShaderFX layer to the project |
| `delete_shader_effect` | `DELETE_SHADER_EFFECT { effect_id }` | Removes it from the library; layers it was applied to keep their compiled shader |

`APPLY_SHADER_EFFECT` fields:

| field | meaning |
|---|---|
| `effect_id` or `source` + `manifest` | a saved effect, or inline code (validated the same way) |
| `kind` | `filter` \| `transition` \| `generator`. Optional: the request's, else the manifest's, else `transition` when `from_layer_id` + `to_layer_id` are given, `filter` when `target_layer_id` is |
| `target_layer_id` | filter: the layer whose picture is `src()`; the effect layer goes just above it and spans its window. Omit to filter everything composited below (the effect goes above the top picture layer) |
| `from_layer_id` + `to_layer_id` | transition: outgoing clip A and incoming clip B (see Transitions below) |
| `params` | values by manifest name: `{ "strength": 0.8, "tint": "#ff8800", "direction": [0, 1] }`. Unknown names or wrong shapes are errors; floats are clamped to the param's min/max |
| `param_keyframes` | animate params over time (see Parameter keyframes below) |
| `start_time`, `end_time` | filter / generator window in timeline seconds (default: the target's window, else the whole timeline). Ignored for transitions |
| `duration_sec`, `easing` | transition length (default 0.8 s) and the easing of its progress (default `linear`) |
| `output` | overrides the manifest's output mode |
| `intensity`, `opacity`, `z_index` | the layer's `c.intensity` (default 1), opacity (default 1) and stacking override |

The result names the new layer (`layer_id`, `createdLayerIds`), its window and the parameter table. Failure codes: `SHADER_FX_INVALID` (shader or manifest errors, with `errors`), `SHADER_FX_INVALID_PARAMS`, `SHADER_FX_TARGET_NOT_FOUND`, `SHADER_FX_CLIPS_NOT_ADJACENT`, `SHADER_FX_NO_HANDLES`, `SHADER_FX_NOT_FOUND`.

The old path still works: `APPLY_VFX` / `TRANSITION` with `custom_shader_frag` is ABI v1 (`evaluate_pixel(uv, time, res, progress, intensity)`, no picture input, light-only output). Use ABI v2 for anything new.

### Workflow

1. Write `source` + `manifest`. Call `create_shader_effect`.
2. If it returns `errors`, fix those lines (they are numbered in YOUR source, not the wrapped shader) and call again.
3. `apply_shader_effect` with the returned `effect_id`, the layers, the window and `params`.
4. `render_preview` at 2-4 timestamps inside the window (for a transition: start, middle, end) and look at the frames. A shader the GPU could not build is reported there (`customShaderErrors`). Adjust `params` or the source and re-apply.
5. Export with `execute_action` `EXPORT_VIDEO`.

You can skip the library and pass `source` + `manifest` straight to `apply_shader_effect` for one-off effects.

```json
{
  "project_id": "proj_123",
  "effect_id": "fx_abc",
  "kind": "transition",
  "from_layer_id": "clip_1",
  "to_layer_id": "clip_2",
  "duration_sec": 0.6,
  "easing": "ease_in_out",
  "params": { "strength": 0.7 }
}
```

### Transitions: the overlap

A transition layer draws across the time where clip A and clip B overlap. `c.progress` runs 0 → 1 across that overlap (keyed on the layer, with `easing`).

- Clips that already overlap: the existing overlap is used (with `duration_sec`, only its last `duration_sec`).
- Clips that meet at a cut: an overlap of `duration_sec` (default 0.8 s, at most half the shorter clip) is created from media handles, without changing the program length. If clip A has media after its out point, A plays on under B (tail handle, the transition starts at the cut). Otherwise, if B has media before its in point, B starts earlier on that earlier media (head handle, the transition ends at the cut).
- Neither clip has enough media beyond the cut: `SHADER_FX_NO_HANDLES`. Overlap the clips first (`TRIM_LAYER` / `SET_SOURCE_RANGE`) or pass a shorter `duration_sec`.
- Clips with a gap between them: `SHADER_FX_CLIPS_NOT_ADJACENT`. `from_layer_id` is the outgoing clip, `to_layer_id` the incoming one.

The effect layer sits above both clips, and `replace` output (the usual choice) covers them for the overlap.

### Parameter keyframes

`param_keyframes` animates manifest params: `{ "<param name>": [ { "time": <timeline seconds>, "value": <the param's own type>, "easing": "<optional>" }, ... ] }`, at least 2 keyframes per param. Each param becomes `fx_param_<slot>` tracks. A `vec2` / `vec3` / `color` gets one track per component. A `bool` steps. Values are encoded like `params` (hex or `[r, g, b(, a)]` for colors, clamped to min/max). Keyed params override the static `params` value while the keyframes apply.

```json
{
  "project_id": "proj_123",
  "effect_id": "fx_streak",
  "target_layer_id": "@primary",
  "start_time": 2, "end_time": 6,
  "params": { "tint": "#66ccff" },
  "param_keyframes": {
    "strength": [ { "time": 2, "value": 0 }, { "time": 3, "value": 1, "easing": "ease_out" }, { "time": 6, "value": 0.2 } ],
    "direction": [ { "time": 2, "value": [1, 0] }, { "time": 6, "value": [0, 1] } ]
  }
}
```

## The author contract

### What you write

```wgsl
fn fx(c: FxCtx) -> vec4<f32> {
    // return STRAIGHT (non-premultiplied) rgba
}
```

You may add your own helper functions, structs and `const`s above `fx`. The server adds the bindings and the entry point. Rejected before compiling:

- any `@fragment`, `@vertex`, `@compute`, `@group` or `@binding`;
- a module-scope `fn` / `struct` / `var` / `const` / `alias` named like a harness symbol: `fs_main`, `vs_main`, `FxCtx`, `FxParams`, `LayerUniforms`, `VertexOutput`, `VertexInput`, `u`, `fxp`, `t_src`, `s_linear`, `t_backdrop`, `t_b`, `src`, `backdrop`, `clip_a`, `clip_b`, `param`, `param_color`, `hash2`, `noise2`, `fbm`, `luma`, `rotate2`, your `P_<name>` accessors, or anything starting with `_fx_` / `_harness_`. A local `let` / `var` inside a function may reuse these names.

### FxCtx

| field | type | meaning |
|---|---|---|
| `uv` | `vec2<f32>` | the effect layer's texture coordinate. The layer is a full-canvas quad, so this is 0..1 across the canvas, top-left origin (y grows downward), and `src(c.uv)` is the pixel under the fragment |
| `px` | `vec2<f32>` | `uv * res` |
| `res` | `vec2<f32>` | render-target size in pixels: the bound backdrop's size (on export, canvas × supersample), else the layer size. It is not the scene canvas size, so build resolution-independent detail from `uv` and use `res` for aspect (`res.x / res.y`) |
| `time` | `f32` | the layer clock: seconds since the effect layer started |
| `local_time` | `f32` | the same layer clock (equal to `time`) |
| `progress` | `f32` | transition: the keyed transition progress, 0 → 1 across the overlap. Filter / generator: `time / layer length`, clamped to 0..1 |
| `intensity` | `f32` | the layer's `fx_intensity` (default 1); multiply your strength by it |

Aspect-correct anything round: `var p = c.uv - vec2<f32>(0.5, 0.5); p.x = p.x * (c.res.x / c.res.y);`

### Pictures you can read (all in canvas space, straight rgba)

| helper | filter | transition | generator |
|---|---|---|---|
| `src(uv)` | the target layer (`target_layer_id`) rendered alone, transparent elsewhere; without a target, everything composited below this layer | clip A | transparent |
| `backdrop(uv)` | everything composited below this layer this frame | same | same |
| `clip_a(uv)` | same as `src` | outgoing clip (`from_layer_id`) | transparent |
| `clip_b(uv)` | transparent | incoming clip (`to_layer_id`) | transparent |

Pictures are full-canvas and the same resolution as the render target. Offset the uv to displace, blur or split. Sampling is linear with clamp-to-edge, so uvs outside 0..1 repeat the edge pixel; mask them yourself if you need transparency there. The helpers sample at mip level 0 (`textureSampleLevel`), so they can be called anywhere, including inside branches and loops.

### Other helpers

| helper | signature | notes |
|---|---|---|
| `P_<name>` | `P_strength()` … | one per manifest param: `float` → `f32`, `vec2` → `vec2<f32>`, `vec3` → `vec3<f32>`, `color` → `vec4<f32>` (straight rgba, 0..1), `bool` → `f32` 0.0 or 1.0 (test `P_flag() > 0.5`). Prefer these over indices |
| `param` | `param(i: u32) -> f32` | raw slot i (0..31, clamped) |
| `param_color` | `param_color(i: u32) -> vec4<f32>` | 4 consecutive slots from i |
| `hash2` | `hash2(p: vec2<f32>) -> f32` | white noise in 0..1 |
| `noise2` | `noise2(p: vec2<f32>) -> f32` | smooth gradient noise, signed (about -0.5..0.5); add 0.5 for 0..1 |
| `fbm` | `fbm(p: vec2<f32>) -> f32` | 4 octaves of `noise2`, also signed |
| `luma` | `luma(rgb: vec3<f32>) -> f32` | Rec. 709 luma (0.2126, 0.7152, 0.0722) |
| `rotate2` | `rotate2(v: vec2<f32>, angle: f32) -> vec2<f32>` | rotate by radians |

### Output modes (`manifest.output`, or `output` on apply)

The harness clamps what `fx` returns to 0..1, multiplies by the layer opacity, and composites premultiplied "over":

- `normal` (default): your rgba over what is below, with real alpha. Alpha 1 black is black, so vignettes, shadows, letterboxes, darkening and full re-renders of a layer all work. For filters that rewrite a picture, return the picture's own alpha (`src(uv).a`) so the area outside the layer stays untouched.
- `add`: `rgb × a` is added onto what is below (light only; nothing is covered). Glows, leaks, sparks, flares. Alpha works as a light mask.
- `replace`: your rgb replaces what is below, with alpha set to the layer opacity (1 by default), over the whole canvas. Use it for transitions between full-frame clips and for generators that paint every pixel. Do not use it for a filter on a layer that does not cover the frame: the transparent area outside the layer would turn black.

### Manifest and parameter slots

```json
{ "abi": 2, "kind": "filter", "output": "normal",
  "params": [ { "name": "strength", "type": "float", "min": 0, "max": 1, "default": 0.5 },
              { "name": "tint", "type": "color", "default": "#ffcc66" },
              { "name": "direction", "type": "vec2", "default": [1, 0] } ] }
```

- `abi` must be 2 if given. `kind`: `filter` (default) | `transition` | `generator`. `output`: `normal` (default) | `add` | `replace`.
- Param names start with a letter and use letters, digits and `_`, at most 40 characters, unique. They become accessors: `P_strength()`, `P_tint()`, `P_direction()`. Optional `min`, `max`, `description`.
- Slot sizes: `float` 1, `bool` 1, `vec2` 2, `vec3` 4 (xyz plus padding), `color` 4 (rgba). Slots are assigned in declaration order, and `vec3` / `color` start on the next multiple of 4. Above: `strength` → 0, slots 1-3 unused, `tint` → 4-7, `direction` → 8-9. Declare 4-slot params first to avoid gaps. Total ≤ 32 slots.
- Value formats: `float` a number; `bool` `true` / `false`; `vec2` `[x, y]` or `{x, y}`; `vec3` `[x, y, z]`; `color` `"#rgb"`, `"#rgba"`, `"#rrggbb"`, `"#rrggbbaa"`, `[r, g, b(, a)]` or `{ r, g, b, a? }` in 0..1.
- Without a `default`: `float` 0 (clamped to min/max), `bool` false, vectors 0, `color` opaque white.

### Validation and limits

- The wrapped shader is compiled with the renderer's own naga (wasm build on the server) before anything is saved or rendered. Errors come back as `{ line, column, message }` on your own lines. An error inside the generated harness has line 0 and usually means `fx` has the wrong signature or a name collides.
- Author source ≤ 24 KB.
- Keep every loop bounded by a constant (`for (var i = 0; i < 8; i = i + 1)`). A layer whose pipeline fails to build or that stalls the GPU is skipped (picture unchanged) and reported.
- The same WGSL runs in preview (WebGPU) and export (Vulkan): no renderer-specific code.

### WGSL pitfalls that fail validation

- Float literals: `1.0`, not `1`, in float math. `let k = 1;` is an `i32` and `k * 0.5` will not compile. Convert with `f32(i)`.
- Vector constructors need the type: `vec2<f32>(0.5, 0.5)`, `vec3<f32>(1.0)` (a single value splats), `vec4<f32>(rgb, a)`.
- `let` is immutable; use `var` for anything you assign to (including swizzle writes like `p.x = ...`).
- There is no `?:`; use `select(if_false, if_true, cond)` or `mix`/`step`.
- No recursion, no implicit conversions between `i32`, `u32` and `f32`; `param(2u)` takes a `u32`.
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

    // A touch of animated grain in the dark area breaks up banding. Built from uv
    // (not px), so the grain size is the same in preview and supersampled export.
    let grain_cell = floor(c.uv * vec2<f32>(720.0 * aspect, 720.0));
    let grain = (hash2(grain_cell + vec2<f32>(c.time * 61.0, c.time * 17.0)) - 0.5) * 0.06;
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

Manifest: `{ "abi": 2, "kind": "generator", "output": "add", "params": [] }`. Apply with `start_time` / `end_time` over the section; it fades itself in and out with `c.progress` (time through the layer).

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
- Motion uses the layer clock (`c.time` = `c.local_time`, 0 when the effect layer starts) or `c.progress`; to stay in sync with something on the timeline, place the layer so its start lines up.
- Detail sizes (grain, noise scale) come from `uv`, not `px`: `res` is the render-target size and is larger on a supersampled export.
- To animate a param over time, use `param_keyframes` rather than hard-coding time curves in the shader, so the same effect stays reusable.
