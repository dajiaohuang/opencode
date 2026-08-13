import { describe, expect, test } from "bun:test"
import { NetworkPreset } from "@opencode-ai/core/session/network-preset"

describe("session network preset", () => {
  test("adds tool denials and a shell prompt without changing unrelated rules", () => {
    const permission = NetworkPreset.apply([{ permission: "edit", pattern: "*", action: "allow" }])

    expect(permission).toEqual([
      { permission: "edit", pattern: "*", action: "allow" },
      { permission: "webfetch", pattern: "*", action: "deny" },
      { permission: "websearch", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "ask" },
    ])
    expect(NetworkPreset.enabled({ [NetworkPreset.metadataKey]: true })).toBe(true)
  })

  test("overrides existing catch-all rules for the affected tools", () => {
    const permission = NetworkPreset.apply(
      [
        { permission: "webfetch", pattern: "*", action: "allow" },
        { permission: "bash", pattern: "git status", action: "allow" },
      ],
    )

    expect(permission).toEqual([
      { permission: "bash", pattern: "git status", action: "allow" },
      { permission: "webfetch", pattern: "*", action: "deny" },
      { permission: "websearch", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "ask" },
    ])
  })

  test("is disabled unless session metadata opts in", () => {
    expect(NetworkPreset.enabled(undefined)).toBe(false)
    expect(NetworkPreset.enabled({ [NetworkPreset.metadataKey]: false })).toBe(false)
  })
})
