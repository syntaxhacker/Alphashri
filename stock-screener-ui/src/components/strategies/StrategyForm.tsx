import { useState } from "react";
import { Modal, Stack, TextInput, Select, Tabs, Alert, Group, Title, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { StrategyFormProps, StrategyFormData } from "./types";
import { DEFAULT_VALUES, getInitialValues } from "./strategyDefaults";
import { OrbParamsPanel } from "./OrbParamsPanel";
import { SrBreakoutParamsPanel } from "./SrBreakoutParamsPanel";
import { EmaParamsPanel } from "./EmaParamsPanel";
import { SwingParamsPanel } from "./SwingParamsPanel";
import { RiskManagementPanel } from "./RiskManagementPanel";
import { RunnerPanel } from "./RunnerPanel";

const STRATEGY_TYPES = [
  { value: "ORB", label: "ORB" },
  { value: "SR_BREAKOUT", label: "S/R Breakout" },
  { value: "52W_CHASER", label: "52W Chaser" },
  { value: "52W_TARGET", label: "52W Target" },
  { value: "EMA_CROSS", label: "EMA Cross" },
];

const INTRADAY_TYPES = ["ORB", "SR_BREAKOUT", "EMA_CROSS"];
const SWING_TYPES = ["52W_CHASER", "52W_TARGET"];

function getNumVal(formData: FormData, key: string, fallback: number): number {
  const v = formData.get(key);
  return v ? Number(v) : fallback;
}

export function StrategyForm({
  mode,
  strategy,
  template,
  opened,
  onClose,
  onSubmit,
}: StrategyFormProps) {
  const initialValues = getInitialValues({ mode, strategy, template });
  const [currentStrategyType, setCurrentStrategyType] = useState(initialValues.strategy_type);
  const isIntraday = INTRADAY_TYPES.includes(currentStrategyType);
  const isSwing = SWING_TYPES.includes(currentStrategyType);
  const isOrb = currentStrategyType === "ORB";
  const isSrBreakout = currentStrategyType === "SR_BREAKOUT";
  const isEmaCross = currentStrategyType === "EMA_CROSS";
  const is52wChaser = currentStrategyType === "52W_CHASER";

  const defaultTab = isOrb ? "orb" : isSrBreakout ? "sr" : isEmaCross ? "ema" : "52w";
  const [activeTab, setActiveTab] = useState(defaultTab);

  const handleSubmit = () => {
    const form = document.querySelector("[data-strategy-form]") as HTMLFormElement;
    if (!form) return;

    const formData = new FormData(form);
    const data: StrategyFormData = {
      name: formData.get("name") as string,
      strategy_type: formData.get("strategy_type") as string,
      parent_id:
        template?.id || (formData.get("parent_id") ? Number(formData.get("parent_id")) : undefined),
      description: (formData.get("description") as string) || undefined,
      or_minutes: getNumVal(formData, "or_minutes", DEFAULT_VALUES.or_minutes),
      sl_pct: getNumVal(formData, "sl_pct", DEFAULT_VALUES.sl_pct),
      tp_pct: getNumVal(formData, "tp_pct", DEFAULT_VALUES.tp_pct),
      min_or_range_pct: getNumVal(formData, "min_or_range_pct", DEFAULT_VALUES.min_or_range_pct),
      max_or_range_pct: getNumVal(formData, "max_or_range_pct", DEFAULT_VALUES.max_or_range_pct),
      max_positions: getNumVal(formData, "max_positions", DEFAULT_VALUES.max_positions),
      max_capital_per_trade_pct: getNumVal(
        formData,
        "max_capital_per_trade_pct",
        DEFAULT_VALUES.max_capital_per_trade_pct,
      ),
      max_daily_loss_pct: getNumVal(
        formData,
        "max_daily_loss_pct",
        DEFAULT_VALUES.max_daily_loss_pct,
      ),
      max_total_exposure_pct: getNumVal(
        formData,
        "max_total_exposure_pct",
        DEFAULT_VALUES.max_total_exposure_pct,
      ),
      risk_per_trade_pct: getNumVal(
        formData,
        "risk_per_trade_pct",
        DEFAULT_VALUES.risk_per_trade_pct,
      ),
      min_trade_value: getNumVal(formData, "min_trade_value", DEFAULT_VALUES.min_trade_value),
      max_trade_value: getNumVal(formData, "max_trade_value", DEFAULT_VALUES.max_trade_value),
      cooldown_minutes: getNumVal(formData, "cooldown_minutes", DEFAULT_VALUES.cooldown_minutes),
      max_distance_from_or_pct: getNumVal(
        formData,
        "max_distance_from_or_pct",
        DEFAULT_VALUES.max_distance_from_or_pct,
      ),
      entry_threshold_pct: getNumVal(
        formData,
        "entry_threshold_pct",
        DEFAULT_VALUES.entry_threshold_pct,
      ),
      trailing_stop_pct: getNumVal(formData, "trailing_stop_pct", DEFAULT_VALUES.trailing_stop_pct),
      trailing_activation_pct: getNumVal(
        formData,
        "trailing_activation_pct",
        DEFAULT_VALUES.trailing_activation_pct,
      ),
      max_holding_days: getNumVal(formData, "max_holding_days", DEFAULT_VALUES.max_holding_days),
      cooldown_days: getNumVal(formData, "cooldown_days", DEFAULT_VALUES.cooldown_days),
      ema_fast_period: getNumVal(formData, "ema_fast_period", DEFAULT_VALUES.ema_fast_period),
      ema_slow_period: getNumVal(formData, "ema_slow_period", DEFAULT_VALUES.ema_slow_period),
      breakout_buffer_pct: getNumVal(
        formData,
        "breakout_buffer_pct",
        DEFAULT_VALUES.breakout_buffer_pct,
      ),
      pivot_type: (formData.get("pivot_type") as string) || DEFAULT_VALUES.pivot_type,
    };

    const enableTrailingEl = form.querySelector(
      "[name='enable_trailing_stop']",
    ) as HTMLInputElement;
    data.enable_trailing_stop = enableTrailingEl ? enableTrailingEl.checked : false;

    const enableFiltersEl = form.querySelector("[name='enable_filters']") as HTMLInputElement;
    data.enable_filters = enableFiltersEl ? enableFiltersEl.checked : false;

    if (data.strategy_type === "EMA_CROSS" && data.ema_fast_period >= data.ema_slow_period) {
      window.alert("Fast EMA period must be less than Slow EMA period");
      return;
    }

    onSubmit(data);
  };

  return (
    <Modal
      className="strategy-form-modal"
      id="strategy-form-modal"
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>{mode === "create" ? "Create Strategy" : "Edit Strategy"}</Title>}
      size="lg"
      data-testid="strategy-form-modal"
    >
      <form
        data-strategy-form
        className="strategy-form"
        id="strategy-form"
        data-testid="strategy-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Stack gap="sm" className="strategy-form-content">
          {template && (
            <Alert
              icon={<IconInfoCircle size={16} />}
              color="blue"
              variant="light"
              className="strategy-form-template-info"
              data-testid="strategy-form-template-info"
            >
              <Text size="sm">
                Creating strategy from template{" "}
                <Text fw={500} span>
                  {template.name}
                </Text>
              </Text>
            </Alert>
          )}

          <TextInput
            label="Strategy Name"
            name="name"
            placeholder="My Custom Strategy"
            defaultValue={initialValues.name}
            required
            data-testid="strategy-name-input"
          />

          <Select
            label="Strategy Type"
            name="strategy_type"
            data={STRATEGY_TYPES}
            defaultValue={initialValues.strategy_type}
            disabled={mode === "edit"}
            onChange={(val) => {
              if (val) {
                setCurrentStrategyType(val);
                setActiveTab(
                  val === "ORB"
                    ? "orb"
                    : val === "SR_BREAKOUT"
                      ? "sr"
                      : val === "EMA_CROSS"
                        ? "ema"
                        : "52w",
                );
              }
            }}
            required
            data-testid="strategy-type-input"
          />

          <TextInput
            label="Description"
            name="description"
            placeholder="Optional description"
            defaultValue={initialValues.description}
            data-testid="strategy-description-input"
          />

          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            className="strategy-form-tabs"
            data-testid="strategy-form-tabs"
          >
            <Tabs.List className="strategy-form-tabs-list" data-testid="strategy-form-tabs-list">
              {isOrb && (
                <Tabs.Tab value="orb" data-testid="strategy-tab-orb">
                  ORB Params
                </Tabs.Tab>
              )}
              {isSrBreakout && (
                <Tabs.Tab value="sr" data-testid="strategy-tab-sr">
                  S/R Breakout
                </Tabs.Tab>
              )}
              {isEmaCross && (
                <Tabs.Tab value="ema" data-testid="strategy-tab-ema">
                  EMA Params
                </Tabs.Tab>
              )}
              {isSwing && (
                <Tabs.Tab value="52w" data-testid="strategy-tab-52w">
                  52W Params
                </Tabs.Tab>
              )}
              <Tabs.Tab value="risk" data-testid="strategy-tab-risk">
                Risk Mgmt
              </Tabs.Tab>
              <Tabs.Tab value="runner" data-testid="strategy-tab-runner">
                Runner
              </Tabs.Tab>
            </Tabs.List>

            {isOrb && <OrbParamsPanel initialValues={initialValues} isSwing={isSwing} />}
            {isSrBreakout && (
              <SrBreakoutParamsPanel initialValues={initialValues} isSwing={isSwing} />
            )}
            {isEmaCross && <EmaParamsPanel initialValues={initialValues} isSwing={isSwing} />}
            {isSwing && (
              <SwingParamsPanel
                initialValues={initialValues}
                isSwing={isSwing}
                is52wChaser={is52wChaser}
              />
            )}
            <RiskManagementPanel initialValues={initialValues} isIntraday={isIntraday} />
            <RunnerPanel initialValues={initialValues} isOrb={isOrb} />
          </Tabs>

          <Group
            justify="flex-end"
            mt="md"
            className="strategy-form-actions"
            data-testid="strategy-form-actions"
          >
            <Group gap="xs">
              <button
                type="button"
                className="mantine-UnstyledButton-root mantine-Button-root mantine-Button--variant-light strategy-form-cancel-btn"
                onClick={onClose}
                data-testid="strategy-cancel-btn"
              >
                <span className="mantine-Button-inner">
                  <span className="mantine-Button-label">Cancel</span>
                </span>
              </button>
              <button
                type="submit"
                className="mantine-UnstyledButton-root mantine-Button-root mantine-Button--variant-filled strategy-form-submit-btn"
                data-testid="submit-strategy-btn"
              >
                <span className="mantine-Button-inner">
                  <span className="mantine-Button-label">
                    {mode === "create" ? "Create" : "Save"}
                  </span>
                </span>
              </button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
