import type { PermissionV1 } from "../v1/permission"

export const rules: PermissionV1.Ruleset = [
  { permission: "webfetch", pattern: "*", action: "deny" },
  { permission: "websearch", pattern: "*", action: "deny" },
  { permission: "bash", pattern: "*", action: "ask" },
]

export const metadataKey = "network_tools_disabled"

export function enabled(metadata: Record<string, unknown> | undefined) {
  return metadata?.[metadataKey] === true
}

export function apply(permission: PermissionV1.Ruleset | undefined): PermissionV1.Rule[] {
  const names = new Set(rules.map((rule) => rule.permission))
  const rest = (permission ?? []).filter((rule) => !(names.has(rule.permission) && rule.pattern === "*"))
  return [...rest, ...rules]
}

export * as NetworkPreset from "./network-preset"
