import { OrbParamsPanel } from "../../components/strategies/OrbParamsPanel";
import { SrBreakoutParamsPanel } from "../../components/strategies/SrBreakoutParamsPanel";
import { EmaParamsPanel } from "../../components/strategies/EmaParamsPanel";
import { SwingParamsPanel } from "../../components/strategies/SwingParamsPanel";
import type { StrategyFormData } from "../../components/strategies/types";

/**
 * Panel component interface accepted by the registry.
 * Each concrete panel receives the form data, a flag indicating swing strategy,
 * and optionally the is52wChaser flag used by SwingParamsPanel.
 */
interface PanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
  is52wChaser?: boolean;
}

type PanelComponent = React.ComponentType<PanelProps>;

/**
 * StrategyParamPanelFactory — Factory Method pattern.
 *
 * Encapsulates the creation of strategy parameter panels behind a
 * static registry. New strategy types can be added at runtime via
 * registerPanel() without modifying the factory's internals, satisfying
 * the Open/Closed Principle.
 *
 * Usage in a JSX context:
 *   StrategyParamPanelFactory.createPanel("ORB", initialValues, false)
 *
 * The returned value is a <Tabs.Panel> element that can be placed
 * directly inside a MUI <Tabs> component.
 */
export class StrategyParamPanelFactory {
  private static registry = new Map<string, PanelComponent>();

  /**
   * Populate the registry with the built-in strategy panels.
   * Called once at module load time.
   */
  static initialize(): void {
    this.registry.set("ORB", OrbParamsPanel);
    this.registry.set("SR_BREAKOUT", SrBreakoutParamsPanel);
    this.registry.set("EMA_CROSS", EmaParamsPanel);
    this.registry.set("52W_CHASER", SwingParamsPanel);
    this.registry.set("52W_TARGET", SwingParamsPanel);
  }

  /**
   * Register a custom panel component for a new strategy type.
   * Enables extensibility — third-party strategy plugins can add
   * themselves without touching this factory.
   *
   * @param type - strategy_type string (e.g. "MY_CUSTOM")
   * @param component - React component receiving PanelProps
   */
  static registerPanel(type: string, component: PanelComponent): void {
    this.registry.set(type, component);
  }

  /**
   * Create the parameter panel JSX for a given strategy type.
   *
   * @param type         - strategy_type (e.g. "ORB", "52W_CHASER")
   * @param initialValues - form default values
   * @param isSwing       - whether the strategy type is a swing strategy
   * @returns A <Tabs.Panel> React element, or null if the type is unknown
   */
  static createPanel(
    type: string,
    initialValues: StrategyFormData,
    isSwing: boolean,
  ): JSX.Element | null {
    const Panel = this.registry.get(type);
    if (!Panel) return null;

    return (
      <Panel
        initialValues={initialValues}
        isSwing={isSwing}
        is52wChaser={type === "52W_CHASER"}
      />
    );
  }
}

// Register the built-in panels at module load time.
StrategyParamPanelFactory.initialize();

// ---------------------------------------------------------------------------
// Convenience React component (so consumers can use it declaratively)
// ---------------------------------------------------------------------------

export interface StrategyParamPanelProps {
  /** strategy_type value (e.g. "ORB", "52W_CHASER", "SR_BREAKOUT") */
  type: string;
  /** Form data used to populate default values */
  initialValues: StrategyFormData;
  /** Whether the strategy is a swing strategy */
  isSwing: boolean;
}

/**
 * Declarative wrapper around StrategyParamPanelFactory.createPanel().
 *
 * @example
 * <StrategyParamPanel type="ORB" initialValues={values} isSwing={false} />
 */
export function StrategyParamPanel({ type, initialValues, isSwing }: StrategyParamPanelProps) {
  return StrategyParamPanelFactory.createPanel(type, initialValues, isSwing);
}
