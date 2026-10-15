import path from "path"
import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM } from "@opencode/ai"
import { compileRequest } from "@opencode/ai/route/client"
import { Document, Info, Event } from "@opencode/schema/config"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Model } from "@opencode/core/model"
import { ModelsDev } from "@opencode/core/models-dev"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ModelsDevPlugin } from "@opencode/core/plugin/models-dev"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { PluginTestLayer } from "../plugin/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)
const config = (budget: boolean) =>
  new Document({
    type: "document",
    info: decode({
      providers: {
        zai: {
          package: "@opencode/ai/providers/anthropic",
          settings: { apiKey: "offline-test-key", baseURL: "http://127.0.0.1:4555/v1" },
          ...(budget
            ? {
                models: {
                  "glm-5.3": {
                    variants: [{ id: "low", settings: { thinking: { type: "enabled", budgetTokens: 2048 } } }],
                  },
                },
              }
            : {}),
        },
      },
    }),
  })

it.live("config updates invalidate catalog variants and restore them on revert", () =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const resolver = yield* ModelResolver.Service
    const bus = yield* Bus.Service
    const models = yield* Model.Service
    const test = yield* Config.Test
    const providerID = Provider.ID.make("zai")
    const modelID = Model.ID.make("glm-5.3")
    const low = Model.VariantID.make("low")
    yield* ModelsDevPlugin.effect(host).pipe(
      Effect.provide(
        ModelsDev.layer({
          file: path.resolve(import.meta.dir, "../../src/models-dev/snapshot.txt"),
          fetch: false,
        }),
      ),
    )
    yield* ConfigProviderPlugin.Plugin.effect(host)
    const selected = Model.Ref.make({ providerID, id: modelID, variant: low })
    expect((yield* models.get(providerID, modelID))!.variants).toEqual([])
    expect((yield* resolver.resolve(selected).pipe(Effect.result))._tag).toBe("Failure")
    yield* test.setEntries([config(true)])
    yield* bus.publish(Event.Updated, {})
    yield* Effect.gen(function* () {
      while (true) {
        const current = yield* models.get(providerID, modelID)
        const thinking = current?.variants?.find((item) => item.id === low)?.settings?.thinking
        if (thinking && typeof thinking === "object" && "budgetTokens" in thinking && thinking.budgetTokens === 2048)
          return
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeout("2 seconds"))
    const after = (yield* resolver.resolve(selected))!
    expect(after.model.route.id).toBe("anthropic-messages")
    yield* compileRequest(LLM.request({ model: after.model, prompt: "hello" }))
    expect(after.ref).toEqual(selected)
    for (const entries of [
      [config(false)],
      [
        new Document({
          type: "document",
          info: decode({ providers: { zai: { settings: { apiKey: "offline-test-key" } } } }),
        }),
      ],
      [config(false)],
    ]) {
      yield* test.setEntries(entries)
      yield* bus.publish(Event.Updated, {})
      const restored = entries[0].info.providers?.zai?.package === undefined
      yield* Effect.gen(function* () {
        while (true) {
          const current = yield* models.get(providerID, modelID)
          if (
            current?.package === (restored ? "@opencode/ai/providers/zai/chat" : "@opencode/ai/providers/anthropic") &&
            current.variants.length === (restored ? 3 : 0)
          )
            return
          yield* Effect.sleep("10 millis")
        }
      }).pipe(Effect.timeout("2 seconds"))
      const current = (yield* models.get(providerID, modelID))!
      expect(current.variants.map((item) => item.id)).toEqual(
        restored ? [low, Model.VariantID.make("high"), Model.VariantID.make("max")] : [],
      )
      const resolved = (yield* resolver.resolve(
        Model.Ref.make({ providerID, id: modelID, ...(restored ? { variant: low } : {}) }),
      ))!
      yield* compileRequest(LLM.request({ model: resolved.model, prompt: "hello" }))
    }
  }).pipe(Effect.provide(Config.testLayer([config(false)]))),
)
