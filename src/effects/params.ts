/**
 * Parameter descriptions: every effect publishes the shape of its `params` (type, range, default),
 * so the UI can build controls automatically and the engine can resolve untrusted values safely.
 */

export interface LocalizedText {
  ru: string
  en: string
}

interface ParamSpecBase {
  key: string
  label: LocalizedText
  /** Optional longer hint for a tooltip. */
  hint?: LocalizedText
}

export interface NumberParamSpec extends ParamSpecBase {
  type: 'number'
  min: number
  max: number
  step: number
  default: number
  /** Display unit, e.g. 's', '°', 'Hz', '%'. Values are stored unscaled. */
  unit?: string
}

export interface BooleanParamSpec extends ParamSpecBase {
  type: 'boolean'
  default: boolean
}

export interface EnumParamSpec extends ParamSpecBase {
  type: 'enum'
  options: { value: string; label: LocalizedText }[]
  default: string
}

export interface ColorParamSpec extends ParamSpecBase {
  type: 'color'
  /** CSS hex color, '#rrggbb'. */
  default: string
}

export type ParamSpec = NumberParamSpec | BooleanParamSpec | EnumParamSpec | ColorParamSpec

export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * Values for every spec: the given value when it is valid (numbers clamped to the range),
 * otherwise the default. Unknown keys are dropped.
 */
export function resolveParams(specs: readonly ParamSpec[], values: Readonly<ParamValues> = {}): ParamValues {
  const out: ParamValues = {}
  for (const spec of specs) out[spec.key] = resolveParam(spec, values[spec.key])
  return out
}

export function resolveParam(spec: ParamSpec, value: ParamValue | undefined): ParamValue {
  switch (spec.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(Math.max(value, spec.min), spec.max)
        : spec.default
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default
    case 'enum':
      return typeof value === 'string' && spec.options.some((o) => o.value === value)
        ? value
        : spec.default
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : spec.default
  }
}

/** Defaults of a spec list as a values record. */
export function defaultParams(specs: readonly ParamSpec[]): ParamValues {
  return resolveParams(specs, {})
}

/** Typed readers for resolved values (resolveParams guarantees the type). */
export function num(values: ParamValues, key: string): number {
  const v = values[key]
  return typeof v === 'number' ? v : 0
}

export function str(values: ParamValues, key: string): string {
  const v = values[key]
  return typeof v === 'string' ? v : ''
}

export function bool(values: ParamValues, key: string): boolean {
  return values[key] === true
}
