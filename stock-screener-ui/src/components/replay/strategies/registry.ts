// Strategy plugin registry — a tiny Map-backed catalog. Built-ins register on import
// of ./index; getStrategy/listStrategies read through. Duplicate ids are a hard error so
// a mis-registered plugin fails loudly at module load instead of silently shadowing.
import type { ReplayStrategyPlugin } from "../core/plugin";

const registry = new Map<string, ReplayStrategyPlugin>();

export function registerStrategy(plugin: ReplayStrategyPlugin): ReplayStrategyPlugin {
  if (registry.has(plugin.id)) {
    throw new Error(`duplicate strategy id: ${plugin.id}`);
  }
  registry.set(plugin.id, plugin);
  return plugin;
}

export function getStrategy(id: string): ReplayStrategyPlugin | undefined {
  return registry.get(id);
}

export function listStrategies(): ReplayStrategyPlugin[] {
  return [...registry.values()];
}
