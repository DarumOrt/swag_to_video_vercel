/**
 * GLSL ES 3.00 sources of the post chain: bright pass → separable blur (bloom), then one composite
 * pass with glitch, VHS, aberration, color grading, invert, vignette, scanlines and grain.
 * Randomness in shaders is an integer hash of (pixel / row, frame / seed) — deterministic.
 */

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  // One triangle covering the screen: (0,0) (2,0) (0,2) in uv.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
uniform float uThreshold;
void main() {
  // 4 bilinear taps = 16-texel box: cheap downsample without shimmering.
  vec2 d = uSrcTexel * 1.5;
  vec3 c = 0.25 * (texture(uSrc, vUv + vec2(-d.x, -d.y)).rgb + texture(uSrc, vUv + vec2(d.x, -d.y)).rgb
                 + texture(uSrc, vUv + vec2(-d.x, d.y)).rgb + texture(uSrc, vUv + vec2(d.x, d.y)).rgb);
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.25, l);
  outColor = vec4(c * k, 1.0);
}
`

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uStep;
void main() {
  // 9-tap Gaussian with linear sampling (5 fetches).
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += texture(uSrc, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture(uSrc, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}
`

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform uint uFrame;

uniform float uBloomIntensity;
uniform float uChroma;
uniform float uRgbSplit;
uniform float uGlitch;
uniform uint uGlitchSeed;
uniform float uGlitchSlices;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uLift;
uniform float uHue;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uToning;
uniform float uInvert;

uniform float uVignette;
uniform float uVignetteSoftness;
uniform float uGrain;
uniform float uGrainSize;
uniform float uScanlines;
uniform float uScanDensity;
uniform float uWobble;
uniform float uVhsNoise;

uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float hash(uint a, uint b) { return float(hashu(a ^ hashu(b + 0x9e3779b9u))) / 4294967295.0; }

vec3 softLight(vec3 base, vec3 blend) {
  vec3 lo = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  vec3 hi = base + (2.0 * blend - 1.0) * (sqrt(base) - base);
  return mix(lo, hi, step(0.5, blend));
}

vec3 hueRotate(vec3 c, float a) {
  // Rotation around the gray axis (Rodrigues).
  const vec3 k = vec3(0.57735026919);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}

void main() {
  vec2 uv = vUv;
  float frame = float(uFrame);
  float yPx = uv.y * uRes.y;
  float scale = uRes.y / 1080.0;

  // --- UV distortions -------------------------------------------------------
  if (uGlitch > 0.0) {
    // Two layers of slices: coarse bands and thin lines, a share of them displaced.
    float coarse = floor(uv.y * uGlitchSlices);
    float fine = floor(uv.y * uGlitchSlices * 4.0);
    float rc = hash(uint(coarse), uGlitchSeed);
    float rf = hash(uint(fine) + 1000u, uGlitchSeed);
    float shift = 0.0;
    if (rc > 0.55) shift += (hash(uint(coarse) + 77u, uGlitchSeed) - 0.5) * 0.22;
    if (rf > 0.85) shift += (hash(uint(fine) + 999u, uGlitchSeed) - 0.5) * 0.08;
    uv.x += shift * uGlitch;
  }
  if (uWobble > 0.0) {
    float w = sin(uv.y * 38.0 + frame * 0.71) * 0.5 + sin(uv.y * 7.0 - frame * 0.29);
    // A tracking band rolling down the frame.
    float band = fract(frame * 0.0037);
    float inBand = smoothstep(0.035, 0.0, abs(uv.y - (1.0 - band)));
    float jitter = hash(uint(yPx / (2.0 * scale)), uFrame) - 0.5;
    uv.x += uWobble * (0.0018 * w + inBand * (0.012 + 0.02 * jitter));
  }

  // --- Sampling with chromatic aberration / RGB split ------------------------
  vec2 dir = uv - 0.5;
  vec2 off = dir * uChroma * 2.0 + vec2(uRgbSplit, 0.0);
  vec4 g = texture(uSrc, uv);
  float r = texture(uSrc, uv + off).r;
  float b = texture(uSrc, uv - off).b;
  vec3 c = vec3(r, g.g, b);
  float alpha = g.a;

  vec3 bloom = texture(uBloom, vUv).rgb * uBloomIntensity;
  c += bloom;
  alpha = max(alpha, clamp(max(bloom.r, max(bloom.g, bloom.b)), 0.0, 1.0));

  // --- Color grading ----------------------------------------------------------
  c *= exp2(uExposure);
  c *= vec3(1.0 + 0.12 * uTemperature, 1.0 - 0.08 * uTint, 1.0 - 0.12 * uTemperature);
  c = (c - 0.5) * uContrast + 0.5;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uSaturation);
  if (uHue != 0.0) c = hueRotate(c, uHue);
  c = clamp(c, 0.0, 1.0);
  if (uToning > 0.0) {
    vec3 tone = mix(uShadowTint, uHighlightTint, smoothstep(0.0, 1.0, lum));
    c = mix(c, softLight(c, tone), uToning);
  }
  c = c * (1.0 - uLift) + uLift;
  c = mix(c, 1.0 - c, uInvert);

  // --- Lens / film ------------------------------------------------------------
  if (uVignette > 0.0) {
    float aspect = uRes.x / uRes.y;
    vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
    float d = length(v) / length(vec2(aspect, 1.0) * 0.5);
    c *= 1.0 - uVignette * smoothstep(0.85 - uVignetteSoftness * 0.7, 1.15, d);
  }
  if (uScanlines > 0.0) {
    float period = 3.0 * scale / uScanDensity;
    float s = 0.5 + 0.5 * cos(gl_FragCoord.y * 6.2831853 / period);
    c *= 1.0 - uScanlines * 0.45 * (1.0 - s);
  }
  if (uVhsNoise > 0.0) {
    float line = floor(yPx / (2.0 * scale));
    if (hash(uint(line), uFrame + 31u) > 1.0 - 0.015 * uVhsNoise) {
      float n = hash(uint(gl_FragCoord.x / (3.0 * scale)) + uint(line) * 4096u, uFrame);
      c = mix(c, vec3(n), 0.6 * uVhsNoise);
    }
  }
  if (uGrain > 0.0) {
    uvec2 cell = uvec2(gl_FragCoord.xy / (uGrainSize * max(scale, 0.5)));
    float n = hash(cell.x + cell.y * 65536u, uFrame) - 0.5;
    float l2 = dot(c, vec3(0.299, 0.587, 0.114));
    // Grain is strongest in the mid-tones, like film.
    c += n * uGrain * (1.0 - abs(l2 - 0.5) * 1.2);
  }

  c = clamp(c, 0.0, 1.0);
  // Output is premultiplied (the source is uploaded premultiplied): color may not exceed alpha.
  outColor = vec4(min(c, vec3(alpha)), alpha);
}
`
