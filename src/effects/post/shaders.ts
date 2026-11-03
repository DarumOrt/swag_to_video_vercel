/**
 * GLSL ES 3.00 fragment shaders of the post passes. The render engine supplies the fullscreen
 * vertex shader (`in vec2 vUv`, 0..1 from bottom-left). Colors are premultiplied alpha.
 * Randomness is an integer hash of (pixel / row, frame / seed) — deterministic.
 */

const HEADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uInput;

uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float hash(uint a, uint b) { return float(hashu(a ^ hashu(b + 0x9e3779b9u))) / 4294967295.0; }

// Work on straight color, write premultiplied (color never exceeds alpha).
vec4 unpremul(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 premul(vec3 c, float a) { return vec4(clamp(c, 0.0, 1.0) * a, a); }
`

/**
 * Accent pass, in order: perspective tilt (camera orbit), mirror / kaleidoscope, glitch slices,
 * VHS line jitter, RGB split + VHS color bleed, hue / saturation, black-and-white, invert, VHS noise.
 */
export const ACCENTS_FS = `${HEADER}
uniform vec2 uRes;
uniform vec2 uRgbSplit;
uniform float uGlitch;
uniform uint uGlitchSeed;
uniform float uGlitchSlices;
uniform float uHue;
uniform float uSaturation;
uniform float uInvert;
uniform float uMono;
uniform float uMonoContrast;
uniform vec3 uMonoTint;
uniform float uMirror;
uniform int uMirrorMode;
uniform float uMirrorSegments;
uniform float uMirrorAngle;
uniform float uVhs;
uniform uint uVhsSeed;
uniform vec2 uTilt;

vec3 hueRotate(vec3 c, float a) {
  // Rotation around the gray axis (Rodrigues).
  const vec3 k = vec3(0.57735026919);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}

// Mirrored repeat, so moved coordinates never hit the clamped edge streaks.
vec2 mirrorRepeat(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }

// The frame as a plane turned by yaw (around Y) and pitch (around X), seen through a pinhole camera.
vec2 tilt(vec2 uv, float aspect) {
  const float F = 1.8;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float cy = cos(uTilt.x), sy = sin(uTilt.x), cp = cos(uTilt.y), sp = sin(uTilt.y);
  vec3 ex = vec3(cy, 0.0, -sy);
  vec3 ey = vec3(sy * sp, cp, cy * sp);
  vec3 n = vec3(sy * cp, -sp, cy * cp);
  vec3 r = vec3(p, F);
  vec3 h = r * (F * n.z / dot(r, n)) - vec3(0.0, 0.0, F);
  // Push in so the near edge stays inside the frame.
  float cover = 1.0 + 0.9 * (abs(sy) + abs(sp));
  return vec2(dot(h, ex), dot(h, ey)) / cover / vec2(aspect, 1.0) + 0.5;
}

vec2 mirrorUv(vec2 uv, float aspect) {
  if (uMirrorMode == 0) return vec2(0.5 - abs(uv.x - 0.5), uv.y);
  if (uMirrorMode == 1) return vec2(uv.x, 0.5 + abs(uv.y - 0.5));
  if (uMirrorMode == 2) return vec2(0.5 - abs(uv.x - 0.5), 0.5 + abs(uv.y - 0.5));
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float seg = 6.2831853 / max(uMirrorSegments, 1.0);
  float a = mod(atan(q.y, q.x) + uMirrorAngle, seg);
  a = abs(a - 0.5 * seg);
  return mirrorRepeat(length(q) * vec2(cos(a), sin(a)) / vec2(aspect, 1.0) + 0.5);
}

vec4 splitSample(vec2 uv, vec2 off) {
  vec4 g = unpremul(texture(uInput, uv));
  return vec4(unpremul(texture(uInput, uv + off)).r, g.g, unpremul(texture(uInput, uv - off)).b, g.a);
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  float scale = max(uRes.y / 1080.0, 0.34);
  vec2 uv = vUv;
  if (uTilt != vec2(0.0)) uv = mirrorRepeat(tilt(uv, aspect));
  vec2 base = uv;
  if (uMirror > 0.0) uv = mirrorUv(uv, aspect);
  if (uGlitch > 0.0) {
    // Two layers of slices: coarse bands and thin lines, a share of them displaced.
    float coarse = floor(uv.y * uGlitchSlices);
    float fine = floor(uv.y * uGlitchSlices * 4.0);
    float shift = 0.0;
    if (hash(uint(coarse), uGlitchSeed) > 0.55) shift += (hash(uint(coarse) + 77u, uGlitchSeed) - 0.5) * 0.22;
    if (hash(uint(fine) + 1000u, uGlitchSeed) > 0.85) shift += (hash(uint(fine) + 999u, uGlitchSeed) - 0.5) * 0.08;
    uv.x += shift * uGlitch;
  }
  float row = floor(vUv.y * uRes.y / (2.0 * scale));
  vec2 off = uRgbSplit;
  if (uVhs > 0.0) {
    // Every line slips a little; a tracking band rolls through with a stronger tear.
    float band = hash(7u, uVhsSeed);
    float inBand = smoothstep(0.04, 0.0, abs(vUv.y - band));
    float jitter = hash(uint(row), uVhsSeed) - 0.5;
    float slip = (0.004 * jitter + inBand * (0.02 + 0.03 * jitter)) * uVhs;
    uv.x += slip;
    base.x += slip;
    off.x += 0.005 * uVhs; // color bleed
  }
  vec4 s = splitSample(uv, off);
  // Cross-fade into / out of the mirror: blend with the unmirrored picture.
  if (uMirror > 0.0 && uMirror < 1.0) s = mix(splitSample(base, off), s, uMirror);
  vec3 c = s.rgb;
  if (uHue != 0.0) c = hueRotate(c, uHue);
  if (uSaturation != 0.0) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(lum), c, max(0.0, 1.0 + uSaturation));
  }
  if (uMono > 0.0) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    lum = clamp((lum - 0.5) * uMonoContrast + 0.5, 0.0, 1.0);
    c = mix(c, lum * uMonoTint, uMono);
  }
  c = mix(c, 1.0 - c, uInvert);
  if (uVhs > 0.0) {
    if (hash(uint(row) + 4099u, uVhsSeed) > 1.0 - 0.03 * uVhs) {
      float n = hash(uint(gl_FragCoord.x / (3.0 * scale)) + uint(row) * 4096u, uVhsSeed);
      c = mix(c, vec3(n), 0.7 * uVhs);
    }
    c *= 1.0 - 0.18 * uVhs * (0.5 + 0.5 * cos(gl_FragCoord.y * 6.2831853 / (3.0 * scale)));
  }
  outColor = premul(c, s.a);
}
`

/** Bloom 1/3: bright pass with a 16-texel box downsample. */
export const BRIGHT_FS = `${HEADER}
uniform vec2 uTexel;
uniform float uThreshold;
void main() {
  vec2 d = uTexel * 1.5;
  vec3 c = 0.25 * (texture(uInput, vUv + vec2(-d.x, -d.y)).rgb + texture(uInput, vUv + vec2(d.x, -d.y)).rgb
                 + texture(uInput, vUv + vec2(-d.x, d.y)).rgb + texture(uInput, vUv + vec2(d.x, d.y)).rgb);
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.25, l), 1.0);
}
`

/** Bloom 2/3: 9-tap Gaussian with linear sampling (5 fetches) along uStep. */
export const BLUR_FS = `${HEADER}
uniform vec2 uStep;
void main() {
  vec3 c = texture(uInput, vUv).rgb * 0.2270270270;
  c += texture(uInput, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uInput, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uInput, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture(uInput, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}
`

/** Bloom 3/3: add the blurred highlights. */
export const BLOOM_COMBINE_FS = `${HEADER}
uniform sampler2D uBloom;
uniform float uStrength;
void main() {
  vec4 src = texture(uInput, vUv);
  vec3 b = texture(uBloom, vUv).rgb * uStrength;
  float a = max(src.a, clamp(max(b.r, max(b.g, b.b)), 0.0, 1.0));
  outColor = vec4(min(src.rgb + b, vec3(a)), a);
}
`

export const CHROMA_FS = `${HEADER}
uniform float uAmount;
void main() {
  vec2 off = (vUv - 0.5) * uAmount * 2.0;
  vec4 g = texture(uInput, vUv);
  float r = texture(uInput, vUv + off).r;
  float b = texture(uInput, vUv - off).b;
  outColor = vec4(min(vec3(r, g.g, b), vec3(g.a)), g.a);
}
`

export const COLOR_GRADE_FS = `${HEADER}
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uLift;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uToning;

vec3 softLight(vec3 base, vec3 blend) {
  vec3 lo = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  vec3 hi = base + (2.0 * blend - 1.0) * (sqrt(base) - base);
  return mix(lo, hi, step(0.5, blend));
}

void main() {
  vec4 s = unpremul(texture(uInput, vUv));
  vec3 c = s.rgb * exp2(uExposure);
  c *= vec3(1.0 + 0.12 * uTemperature, 1.0 - 0.08 * uTint, 1.0 - 0.12 * uTemperature);
  c = (c - 0.5) * uContrast + 0.5;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(lum), c, uSaturation), 0.0, 1.0);
  if (uToning > 0.0) {
    vec3 tone = mix(uShadowTint, uHighlightTint, smoothstep(0.0, 1.0, lum));
    c = mix(c, softLight(c, tone), uToning);
  }
  c = c * (1.0 - uLift) + uLift;
  outColor = premul(c, s.a);
}
`

export const VIGNETTE_FS = `${HEADER}
uniform vec2 uRes;
uniform float uAmount;
uniform float uSoftness;
void main() {
  vec4 s = texture(uInput, vUv);
  float aspect = uRes.x / uRes.y;
  vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
  float d = length(v) / length(vec2(aspect, 1.0) * 0.5);
  float k = 1.0 - uAmount * smoothstep(0.85 - uSoftness * 0.7, 1.15, d);
  outColor = vec4(s.rgb * k, s.a);
}
`

/** VHS: tracking wobble, scanlines, noise lines. */
export const SCANLINES_FS = `${HEADER}
uniform vec2 uRes;
uniform uint uFrame;
uniform float uAmount;
uniform float uDensity;
uniform float uWobble;
uniform float uNoise;
void main() {
  vec2 uv = vUv;
  float frame = float(uFrame);
  float scale = uRes.y / 1080.0;
  float yPx = uv.y * uRes.y;
  if (uWobble > 0.0) {
    float w = sin(uv.y * 38.0 + frame * 0.71) * 0.5 + sin(uv.y * 7.0 - frame * 0.29);
    // A tracking band rolling down the frame.
    float band = fract(frame * 0.0037);
    float inBand = smoothstep(0.035, 0.0, abs(uv.y - (1.0 - band)));
    float jitter = hash(uint(yPx / (2.0 * scale)), uFrame) - 0.5;
    uv.x += uWobble * (0.0018 * w + inBand * (0.012 + 0.02 * jitter));
  }
  vec4 s = texture(uInput, uv);
  vec3 c = s.rgb;
  if (uAmount > 0.0) {
    float period = 3.0 * max(scale, 0.34) / uDensity;
    float k = 0.5 + 0.5 * cos(gl_FragCoord.y * 6.2831853 / period);
    c *= 1.0 - uAmount * 0.45 * (1.0 - k);
  }
  if (uNoise > 0.0) {
    float line = floor(yPx / (2.0 * scale));
    if (hash(uint(line), uFrame + 31u) > 1.0 - 0.015 * uNoise) {
      float n = hash(uint(gl_FragCoord.x / (3.0 * scale)) + uint(line) * 4096u, uFrame);
      c = mix(c, vec3(n) * s.a, 0.6 * uNoise);
    }
  }
  outColor = vec4(min(c, vec3(s.a)), s.a);
}
`

export const GRAIN_FS = `${HEADER}
uniform vec2 uRes;
uniform uint uFrame;
uniform float uAmount;
uniform float uSize;
void main() {
  vec4 s = unpremul(texture(uInput, vUv));
  float scale = max(uRes.y / 1080.0, 0.5);
  uvec2 cell = uvec2(gl_FragCoord.xy / (uSize * scale));
  float n = hash(cell.x + cell.y * 65536u, uFrame) - 0.5;
  float l = dot(s.rgb, vec3(0.299, 0.587, 0.114));
  // Strongest in the mid-tones, like film.
  vec3 c = s.rgb + n * uAmount * (1.0 - abs(l - 0.5) * 1.2);
  outColor = premul(c, s.a);
}
`
