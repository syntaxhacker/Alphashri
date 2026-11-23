import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
  Alert,
  Badge,
  Box,
  Button,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  ToolbarRow,
} from "@/ui";
import { showSuccess } from "@/ui/notifications";
import { addOptionPaperLeg } from "@/api/optionsPaper";
import { upsertPosition } from "@/state/optionsPaper";
import { reducedMotionClass, transitionClass } from "@/pages/options-replay/replayMotion";
import type { OptionAction, OptionPaperLeg, OptionPaperPosition, OptionType } from "@/types/optionsPaper";

const MAX_LEGS = 4;

interface AddLegDialogProps {
  opened: boolean;
  position: OptionPaperPosition | null;
  onClose: () => void;
}

/** datetime-local carries no zone; the book quotes IST, so pin the offset. */
function toIstIso(local: string): string {
  if (!local) return "";
  return /[Zz]|[+-]\d{2}:\d{2}$/.test(local) ? local : `${local}+05:30`;
}

function nowIstLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function legChip(leg: OptionPaperLeg): string {
  const strike = Number(leg.strike);
  return `${leg.action} ${leg.optType} ${(Number.isFinite(strike) ? strike : 0).toLocaleString("en-IN")} × ${leg.lots}`;
}

function sameToken(left: unknown, right: string): boolean {
  return typeof left === "string" && left.trim().toUpperCase() === right;
}

function legsOf(position: OptionPaperPosition): OptionPaperLeg[] {
  return Array.isArray(position.legs) ? position.legs : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AddLegDialog(props: AddLegDialogProps) {
  const [action, setAction] = createSignal<OptionAction>("BUY");
  const [opt, setOpt] = createSignal<OptionType>("CE");
  const [strike, setStrike] = createSignal<number | string>("");
  const [lots, setLots] = createSignal<number | string>(1);
  const [entryTime, setEntryTime] = createSignal(nowIstLocal());
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // The dialog instance is reused across rows, so both reopening and a parent
  // swapping the selected position must clear the previous leg's inputs/failure.
  createEffect(on(
    () => `${props.opened ? "open" : "closed"}:${props.position?.id ?? "-"}`,
    () => {
      if (!props.opened) return;
      setAction("BUY");
      setOpt("CE");
      setStrike("");
      setLots(1);
      setEntryTime(nowIstLocal());
      setError(null);
      setLoading(false);
    },
  ));

  const validate = (position: OptionPaperPosition): string | null => {
    const legs = legsOf(position);
    if (!Array.isArray(position.legs)) return "This structure has no leg list.";
    if (legs.length >= MAX_LEGS) {
      return `A structure can hold at most ${MAX_LEGS} legs.`;
    }
    const strikeValue = Number(strike());
    if (!Number.isFinite(strikeValue) || strikeValue <= 0) {
      return "Strike must be greater than zero.";
    }
    const lotsValue = Number(lots());
    if (!Number.isFinite(lotsValue) || lotsValue < 1) {
      return "Lots must be at least 1.";
    }
    const duplicate = legs.some(
      (leg) =>
        sameToken(leg.action, action()) &&
        sameToken(leg.optType, opt()) &&
        Number(leg.strike) === strikeValue,
    );
    return duplicate ? "That action / option / strike already exists in this structure." : null;
  };

  const submit = async () => {
    const position = props.position;
    if (loading()) return;
    if (!position) {
      setError("Select a position first.");
      return;
    }
    const problem = validate(position);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const updated = await addOptionPaperLeg(position.id, {
        action: action(),
        opt: opt(),
        strike: Number(strike()),
        lots: Number(lots()),
        entryTs: toIstIso(entryTime()),
      });
      upsertPosition(updated);
      const legCount = Array.isArray(updated.legs)
        ? updated.legs.length
        : position.legs.length + 1;
      showSuccess("Leg added", `${position.underlying} structure now has ${legCount} legs`);
      props.onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="ADD LEG"
      size="sm"
      padding="md"
      data-testid="add-leg-dialog"
    >
      <Show when={props.position} fallback={<Text size="xs" c="dimmed">Select a position first.</Text>}>
        {(position) => (
          <Stack gap={16}>
            <Box className="flex flex-col gap-2">
              <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-fin-text-muted">
                CURRENT STRUCTURE
              </Text>
              <Box data-testid="add-leg-existing" className="flex min-h-[20px] flex-wrap gap-1">
                <Show
                  when={legsOf(position()).length > 0}
                  fallback={<Text c="dimmed" className="text-[11px]">No legs yet.</Text>}
                >
                  <For each={legsOf(position())}>
                    {(leg) => (
                      <Badge
                        size="sm"
                        color={leg.action === "BUY" ? "primary" : "info"}
                        variant="light"
                        style={{ "font-size": "11px", height: "18px" }}
                      >
                        {legChip(leg)}
                      </Badge>
                    )}
                  </For>
                </Show>
              </Box>
            </Box>

            <Box
              data-testid="add-leg-section-leg"
              className="flex flex-col gap-2 border-t border-fin-border-subtle pt-4"
            >
              <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-fin-text-muted">
                LEG
              </Text>
              <ToolbarRow gap={8}>
                <Box className="min-w-0 flex-1">
                  <Select
                    size="sm"
                    label="ACTION"
                    data={["BUY", "SELL"]}
                    value={action()}
                    onChange={(value) => setAction(value === "SELL" ? "SELL" : "BUY")}
                    data-testid="add-leg-action"
                    aria-label="Action"
                  />
                </Box>
                <Box className="min-w-0 flex-1">
                  <Select
                    size="sm"
                    label="OPTION"
                    data={["CE", "PE"]}
                    value={opt()}
                    onChange={(value) => setOpt(value === "PE" ? "PE" : "CE")}
                    data-testid="add-leg-opt"
                    aria-label="Option type"
                  />
                </Box>
              </ToolbarRow>

              <ToolbarRow gap={8}>
                <Box className="min-w-0 flex-1">
                  <NumberInput
                    size="sm"
                    label="STRIKE"
                    placeholder="e.g. 1420"
                    min={0.01}
                    decimalScale={2}
                    hideControls
                    value={strike()}
                    onChange={setStrike}
                    data-testid="add-leg-strike"
                    aria-label="Strike"
                  />
                </Box>
                <Box className="min-w-0 flex-1">
                  <NumberInput
                    size="sm"
                    label="LOTS"
                    min={1}
                    hideControls
                    value={lots()}
                    onChange={setLots}
                    data-testid="add-leg-lots"
                    aria-label="Lots"
                  />
                </Box>
              </ToolbarRow>
            </Box>

            <Box
              data-testid="add-leg-section-entry"
              className="flex flex-col gap-2 border-t border-fin-border-subtle pt-4"
            >
              <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-fin-text-muted">
                ENTRY
              </Text>
              <TextInput
                size="sm"
                type="datetime-local"
                label="ENTRY TIME (IST)"
                value={entryTime()}
                onChange={setEntryTime}
                data-testid="add-leg-entry-time"
                aria-label="Entry time (IST)"
              />
            </Box>

            <Show when={loading()}>
              <Text
                c="dimmed"
                className={`text-[11px] ${transitionClass("state")} ${reducedMotionClass()} animate-pulse motion-reduce:animate-none`}
                data-testid="add-leg-loading"
              >
                Adding leg…
              </Text>
            </Show>

            <Show when={error()}>
              {(message) => (
                <Alert color="error" variant="light" data-testid="add-leg-error">
                  <Text className="text-[11px]">{message()}</Text>
                </Alert>
              )}
            </Show>

            <ToolbarRow
              gap={8}
              justify="flex-end"
              className="border-t border-fin-border-subtle pt-4"
            >
              <Button size="sm" variant="default" disabled={loading()} onClick={props.onClose}>
                CANCEL
              </Button>
              <Button
                size="sm"
                variant="filled"
                loading={loading()}
                onClick={() => void submit()}
                data-testid="add-leg-submit"
              >
                ADD LEG
              </Button>
            </ToolbarRow>
          </Stack>
        )}
      </Show>
    </Modal>
  );
}
