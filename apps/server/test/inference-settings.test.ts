import { expect, test } from "bun:test";
import { Effect } from "effect";
import { SettingsService } from "../src/services/settings-service";
import { defaultServerInferenceSettings } from "@openteam/contracts";

test("unconfigured installations can browse models without saving a selection", async () => {
  let saves = 0;
  const service = new SettingsService(
    {
      loadInferenceSettings: async (options: unknown) => {
        expect(options).toEqual({ allowUnconfigured: true });
        return defaultServerInferenceSettings();
      },
      writeInferenceSettings: async () => {
        saves++;
      },
    } as never,
    (async (path: string) => {
      expect(path).toBe("/v1/inference/providers?provider=openai-codex");
      return { providers: [], models: [], modelProviderId: "openai-codex" };
    }) as never
  );

  const settings = await Effect.runPromise(service.serverSettings());
  expect(settings.inference.modelId).toBe("");
  expect(settings.models).toEqual([]);
  await expect(
    Effect.runPromise(service.updateInferenceSettings(settings.inference))
  ).rejects.toThrow("Invalid inference model");
  expect(saves).toBe(0);
});
