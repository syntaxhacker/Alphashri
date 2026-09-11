// Strategy registry entrypoint — importing this module registers every built-in plugin.
// Consumers should import getStrategy/listStrategies from here so registration is guaranteed.
import { registerStrategy } from "./registry";
import vwapOrb from "./vwapOrb";
import smcIfvg from "./smcIfvg";
import week52Chaser from "./week52Chaser";

registerStrategy(vwapOrb);
registerStrategy(smcIfvg);
registerStrategy(week52Chaser);

export { registerStrategy, getStrategy, listStrategies } from "./registry";
export type {
  ReplayStrategyPlugin,
  ReplayParamSpec,
  ReplayParamValues,
  TimelineData,
} from "../core/plugin";
