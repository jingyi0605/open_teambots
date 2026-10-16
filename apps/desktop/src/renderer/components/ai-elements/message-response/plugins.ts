import type { PluginConfig } from "streamdown";
import type { AdvancedMessageCapabilities } from "./capabilities";

type Feature = keyof AdvancedMessageCapabilities;
const FEATURES: readonly Feature[] = ["cjk", "code", "math", "mermaid"];

const pluginConfigByCapability = new Map<string, Promise<PluginConfig>>();
const loadedPlugins: PluginConfig = {};
const loaders: Record<Feature, () => Promise<unknown>> = {
  cjk: () =>
    import("./cjk").then((module) => {
      loadedPlugins.cjk = module.cjk;
    }),
  code: () =>
    import("./code").then((module) => {
      loadedPlugins.code = module.code;
    }),
  math: () =>
    import("./math").then((module) => {
      loadedPlugins.math = module.math;
    }),
  mermaid: () =>
    import("./mermaid").then((module) => {
      loadedPlugins.mermaid = module.mermaid;
    }),
};

const capabilityKey = ({ cjk, code, math, mermaid }: AdvancedMessageCapabilities) =>
  `${Number(cjk)}${Number(code)}${Number(math)}${Number(mermaid)}`;

/** React's `use` reads a settled value from these fields without suspending. */
export const markFulfilled = <T>(promise: Promise<T>, value: T): Promise<T> =>
  Object.assign(promise, { status: "fulfilled", value });

const selectedPlugins = (capabilities: AdvancedMessageCapabilities): PluginConfig => {
  const plugins: PluginConfig = {};
  for (const feature of FEATURES) {
    if (capabilities[feature]) Object.assign(plugins, { [feature]: loadedPlugins[feature] });
  }
  return plugins;
};

/** Starts independent feature requests together so splitting the plug-ins does
 * not turn rich rendering into a serial network waterfall. Once the modules are
 * loaded the configuration is already settled, so a message renders without a
 * Suspense fallback (its raw Markdown) in between. */
export const loadAdvancedMessagePlugins = (capabilities: AdvancedMessageCapabilities) => {
  const key = capabilityKey(capabilities);
  const existing = pluginConfigByCapability.get(key);
  if (existing) return existing;

  const missing = FEATURES.filter((feature) => capabilities[feature] && !loadedPlugins[feature]);
  let promise: Promise<PluginConfig>;
  if (missing.length === 0) {
    const plugins = selectedPlugins(capabilities);
    promise = markFulfilled(Promise.resolve(plugins), plugins);
  } else {
    promise = Promise.all(missing.map((feature) => loaders[feature]())).then(() => {
      const plugins = selectedPlugins(capabilities);
      markFulfilled(promise, plugins);
      return plugins;
    });
    // A failed import must be retried by the next message, not cached.
    promise.catch(() => {
      if (pluginConfigByCapability.get(key) === promise) pluginConfigByCapability.delete(key);
    });
  }
  pluginConfigByCapability.set(key, promise);
  return promise;
};

/** Loads every rich-message feature in the background after startup. */
export const preloadAdvancedMessagePlugins = () =>
  Promise.all(FEATURES.filter((feature) => !loadedPlugins[feature]).map((f) => loaders[f]()));
