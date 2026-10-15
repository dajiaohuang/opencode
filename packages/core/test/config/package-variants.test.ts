import path from "path"
import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM } from "@opencode/ai"
import { compileRequest } from "@opencode/ai/route/client"
import { Document, Info } from "@opencode/schema/config"
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
const anthropic = "@opencode/ai/providers/anthropic"
const providerID = Provider.ID.make("zai")
const modelID = Model.ID.make("glm-5.3")
const low = Model.VariantID.make("low")

for (const scenario of [
  "package-only",
  "same-package",
  "explicit-variant",
  "model-package",
  "layered-override",
  "empty-variants",
  "layered-revert",
  "independent-package",
  "late-variant",
  "late-package",
  "alias",
  "alias-package",
  "model-only",
  "provider-variant",
  "layered-explicit",
  "legacy-package",
] as const) {
  it.effect(`actual bundled catalog/config/resolver/request: ${scenario}`, () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      yield* ModelsDevPlugin.effect(host).pipe(
        Effect.provide(
          ModelsDev.layer({
            file: path.resolve(import.meta.dir, "../../src/models-dev/snapshot.txt"),
            fetch: false,
          }),
        ),
      )
      yield* providers.transform((editor) =>
        editor.update(providerID, (provider) => {
          provider.activation = "enabled"
        }),
      )
      const original = (yield* models.get(providerID, modelID))!
      expect(original.package).toBe("@opencode/ai/providers/zai/chat")
      expect(original.variants?.map((item) => item.id)).toEqual([
        low,
        Model.VariantID.make("high"),
        Model.VariantID.make("max"),
      ])
      if (scenario === "independent-package")
        yield* providers.transform((editor) =>
          editor.models.update(providerID, modelID, (model) => {
            model.package = original.package
          }),
        )
      if (scenario === "provider-variant")
        yield* providers.transform((editor) =>
          editor.models.update(providerID, modelID, (model) => {
            model.variants = [{ id: low, settings: { thinking: { type: "enabled", budgetTokens: 2048 } } }]
          }),
        )
      if (scenario === "late-package")
        yield* models.transform((editor) =>
          editor.update(providerID, modelID, (model) => {
            model.package = original.package
          }),
        )
      if (scenario === "late-variant")
        yield* models.transform((editor) =>
          editor.update(providerID, modelID, (model) => {
            model.variants = [{ id: low, settings: { thinking: { type: "enabled", budgetTokens: 2048 } } }]
          }),
        )
      const target =
        scenario === "legacy-package"
          ? "aisdk:@ai-sdk/openai-compatible"
          : scenario === "same-package" || scenario === "model-only"
            ? original.package
            : anthropic
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              zai: {
                package: target,
                settings: { baseURL: "http://127.0.0.1:4555/v1", apiKey: "offline-test-key" },
                ...(scenario === "explicit-variant"
                  ? {
                      models: {
                        "glm-5.3": {
                          variants: [{ id: "low", settings: { thinking: { type: "enabled", budgetTokens: 2048 } } }],
                        },
                      },
                    }
                  : {}),
                ...(scenario === "empty-variants" ? { models: { "glm-5.3": { variants: [] } } } : {}),
                ...(scenario === "model-package" ? { models: { "glm-5.3": { package: original.package } } } : {}),
                ...(scenario === "model-only" ? { models: { "glm-5.3": { package: anthropic } } } : {}),
              },
            },
          }),
        }),
      ]
      if (scenario === "layered-override")
        entries.unshift(
          new Document({ type: "document", info: decode({ providers: { zai: { package: original.package } } }) }),
        )
      if (scenario === "layered-explicit")
        entries.unshift(
          new Document({
            type: "document",
            info: decode({
              providers: {
                zai: {
                  models: {
                    "glm-5.3": {
                      variants: [{ id: "low", settings: { thinking: { type: "enabled", budgetTokens: 2048 } } }],
                    },
                  },
                },
              },
            }),
          }),
        )
      if (scenario === "layered-revert")
        entries.push(
          new Document({ type: "document", info: decode({ providers: { zai: { package: original.package } } }) }),
        )
      if (scenario === "alias" || scenario === "alias-package")
        entries.push(
          new Document({
            type: "document",
            info: decode({
              providers: {
                mirror: {
                  canonical: "zai",
                  package: anthropic,
                  settings: { apiKey: "offline-test-key" },
                  models: { "glm-5.3": scenario === "alias-package" ? { package: original.package } : {} },
                },
              },
            }),
          }),
        )
      yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
      const selected = (yield* models.get(providerID, modelID))!
      expect(selected.package).toBe(
        ["model-package", "independent-package", "layered-revert", "late-package"].includes(scenario)
          ? original.package
          : scenario === "model-only"
            ? anthropic
            : scenario === "legacy-package"
              ? original.package
              : target,
      )
      // Exercise replay, not just the first materialization.
      yield* providers.reload()
      yield* models.reload()
      const reloaded = (yield* models.get(providerID, modelID))!
      expect(reloaded.variants).toEqual(selected.variants)
      const resolver = yield* ModelResolver.Service
      if (scenario === "alias" || scenario === "alias-package") {
        const alias = (yield* models.get(Provider.ID.make("mirror"), modelID))!
        expect(alias.variants.map((item) => item.id)).toEqual(
          scenario === "alias" ? [] : original.variants.map((item) => item.id),
        )
        const ref = Model.Ref.make({
          providerID: Provider.ID.make("mirror"),
          id: modelID,
          ...(scenario === "alias-package" ? { variant: low } : {}),
        })
        const resolved = (yield* resolver.resolve(ref))!
        yield* compileRequest(LLM.request({ model: resolved.model, prompt: "hello" }))
        return
      }
      if (["package-only", "layered-override", "empty-variants", "model-only"].includes(scenario)) {
        expect(reloaded.variants).toEqual([])
        expect(
          (yield* resolver.resolve(Model.Ref.make({ providerID, id: modelID, variant: low })).pipe(Effect.result))._tag,
        ).toBe("Failure")
        const plain = (yield* resolver.resolve(Model.Ref.make({ providerID, id: modelID })))!
        yield* compileRequest(LLM.request({ model: plain.model, prompt: "hello" }))
        return
      }
      if (scenario === "explicit-variant" || scenario === "layered-explicit" || scenario === "provider-variant") {
        expect(reloaded.variants.map((item) => item.id)).toEqual([low])
        expect(reloaded.variants[0].settings).toEqual({ thinking: { type: "enabled", budgetTokens: 2048 } })
      }
      const resolved = (yield* resolver.resolve(Model.Ref.make({ providerID, id: modelID, variant: low })))!
      expect(resolved.ref.variant).toBe(low)
      yield* compileRequest(LLM.request({ model: resolved.model, prompt: "hello" }))
    }),
  )
}
