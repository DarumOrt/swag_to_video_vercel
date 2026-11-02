/**
 * Parameter schema the UI builds controls from. STUB of the shape expected from `@/render`
 * (style presets) and `@/effects` (accent effects); when those modules ship their own schemas,
 * map them here so components keep working unchanged.
 */

export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>

interface ParamBase {
  key: string
  label: string
  /** Optional group heading in the generated form. */
  group?: string
}

export type ParamSchema =
  | (ParamBase & { kind: 'color'; default: string })
  | (ParamBase & { kind: 'range'; min: number; max: number; step: number; default: number })
  | (ParamBase & { kind: 'toggle'; default: boolean })
  | (ParamBase & {
      kind: 'select'
      options: readonly { value: string; label: string }[]
      default: string
    })
  | (ParamBase & { kind: 'text'; default: string; placeholder?: string })

export function defaultValues(schema: readonly ParamSchema[]): ParamValues {
  return Object.fromEntries(schema.map((param) => [param.key, param.default]))
}

/** Values for `schema`, taking known keys from `values` (wrong types fall back to defaults). */
export function resolveValues(schema: readonly ParamSchema[], values: ParamValues): ParamValues {
  return Object.fromEntries(
    schema.map((param) => {
      const value = values[param.key]
      return [param.key, typeof value === typeof param.default ? value! : param.default]
    }),
  )
}
