export * as CatalogVariants from "./catalog-variants.js"

import { Model } from "@opencode/schema/model"
import { isDeepStrictEqual } from "node:util"

// Internal provenance, deliberately not part of Model.Info's public wire schema.
const packages = new WeakMap<Model.Info, { packageName: string; variants: Model.Info["variants"] }>()

export function bind<T extends Model.Info>(model: T, packageName: string): T {
  packages.set(model, { packageName, variants: structuredClone(model.variants) })
  return model
}

export function source(model: Model.Info) {
  const origin = packages.get(model)
  return origin && isDeepStrictEqual(origin.variants, model.variants) ? origin.packageName : undefined
}

export function copy<T extends Model.Info>(model: T): T {
  const result = structuredClone(model)
  const packageName = source(model)
  if (packageName !== undefined) bind(result, packageName)
  return result
}
