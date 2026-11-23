import { Show, type JSX } from "solid-js";
import { Alert, Box, Button, Group, Loader, Text, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { IconAlertCircle, IconDatabaseOff, IconMoon } from "@/components/common/Icons";
import { cn } from "@/ui/cn";
import { CompactPanel } from "./compact";

export interface InlineLoaderProps {
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
  size?: string;
  message?: string;
  showSpinner?: boolean;
  children?: JSX.Element;
}

export function InlineLoader(props: InlineLoaderProps) {
  const testId = () => props["data-testid"] ?? props.dataTestid;
  const size = () => props.size ?? "sm";
  const showSpinner = () => props.showSpinner ?? true;
  return (
    <Group justify="center" direction="column" gap="xs" py="xl" data-testid={testId()} className={props.className}>
      {showSpinner() && <Loader size={size()} />}
      {props.children || (props.message && <Text size="xs" c="dimmed">{props.message}</Text>)}
    </Group>
  );
}

/**
 * An empty state is a *reason*, not a shrug. The three emptinesses look and read
 * differently on purpose — they are not one message with different words:
 *   no-data       — nothing was recorded (recorder off / session not captured).
 *                   Not the reader's fault, not fixable from this screen.
 *   market-closed — the venue is shut, so there is nothing to record yet.
 *                   Expected; never rendered as an error.
 *   failed        — the fetch failed or came back unusable. Ours, and retryable.
 *
 * `layout="row"` is the dense one-line band used by fixed-height rails;
 * `layout="stack"` is the centred card used inside a panel.
 */
export type EmptyStateKind = "no-data" | "market-closed" | "failed";
export type EmptyStateTone = "muted" | "info" | "warning" | "error";

/**
 * Collapse rules are injected into `document.head` rather than rendered as a
 * `<style>` child: a style node inside a panel would be read by `innerText`
 * assertions and pollute the band's copy. One sheet per selector, keyed by its
 * own id, mounted once per document. Returns `null` so it is a legal JSX child
 * (`{injectCollapseRule(...)}` scoped to the markup that needs it).
 */
const COLLAPSE_SHEETS = new Set<string>();

export function injectCollapseRule(id: string, css: string): null {
  if (typeof document === "undefined") return null;
  if (COLLAPSE_SHEETS.has(id)) return null;
  if (document.getElementById(`fin-empty-collapse-${id}`)) {
    COLLAPSE_SHEETS.add(id);
    return null;
  }
  const sheet = document.createElement("style");
  sheet.id = `fin-empty-collapse-${id}`;
  sheet.textContent = css;
  document.head.appendChild(sheet);
  COLLAPSE_SHEETS.add(id);
  return null;
}

const EMPTY_TONE_INK: Record<EmptyStateTone, string> = {
  muted: palette.TEXT_MUTED,
  info: palette.INFO,
  warning: palette.WARNING,
  error: palette.NEGATIVE,
};

/** A kind fixes both the ink and the glyph, so the three states cannot drift
 *  into looking identical. Tone/glyph props override per call site. */
const EMPTY_KIND_DEFAULTS: Record<
  EmptyStateKind,
  { tone: EmptyStateTone; title: string; description: string }
> = {
  "no-data": {
    tone: "muted",
    title: "Nothing recorded",
    description: "The recorder was not running for this session",
  },
  "market-closed": {
    tone: "info",
    title: "Market closed",
    description: "Recording resumes at the 09:15 IST open",
  },
  failed: {
    tone: "error",
    title: "Could not load",
    description: "The request failed — retry, it is usually transient",
  },
};

interface EmptyStateProps {
  icon?: JSX.Element;
  emoji?: string;
  /** Fixes tone + default icon/copy for the three emptinesses. */
  kind?: EmptyStateKind;
  title?: string;
  description?: string;
  /** One muted footnote about cadence / window / next step. */
  hint?: string;
  /** Ink for the glyph tile; the copy stays TEXT / TEXT_MUTED at AA. */
  tone?: EmptyStateTone;
  /** Exactly one recovery control; omit it when the state is not recoverable. */
  action?: JSX.Element;
  /** stack = centred card inside a panel; row = one dense band inside a rail. */
  layout?: "stack" | "row";
  /** Lets a caller keep asserting the explanation it used to render inline. */
  descriptionTestId?: string;
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
}

export function EmptyState(props: EmptyStateProps) {
  const kindDefault = () => (props.kind ? EMPTY_KIND_DEFAULTS[props.kind] : null);
  const tone = () => props.tone ?? kindDefault()?.tone ?? "muted";
  const ink = () => EMPTY_TONE_INK[tone()];
  const title = () => props.title ?? kindDefault()?.title ?? "";
  const description = () => props.description ?? kindDefault()?.description;
  const row = () => props.layout === "row";
  const testId = () => props["data-testid"] ?? props.dataTestid;
  const glyphSize = () => (row() ? 14 : 18);
  const fallbackGlyph = () => {
    if (props.emoji) return <Text size="xs" style={{ "line-height": "1" }}>{props.emoji}</Text>;
    if (props.kind === "failed") return <IconAlertCircle size={glyphSize()} />;
    if (props.kind === "market-closed") return <IconMoon size={glyphSize()} />;
    return <IconDatabaseOff size={glyphSize()} />;
  };
  return (
    <div
      data-testid={testId()}
      data-empty-kind={props.kind}
      data-empty-layout={row() ? "row" : "stack"}
      class={cn(
        "flex min-w-0 font-mono",
        row() ? "items-start gap-1.5 px-1" : "flex-col items-center justify-center gap-1 px-2 py-2 text-center",
        props.className,
      )}
      style={{ display: "flex", "min-width": 0 }}
    >
      <Box
        className="flex shrink-0 items-center justify-center"
        aria-hidden="true"
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: row() ? "18px" : "32px",
          height: row() ? "18px" : "32px",
          "flex-shrink": 0,
          "margin-top": row() ? "1px" : undefined,
          "border-radius": "2px",
          // A tint + hairline rail, never text on a saturated fill.
          border: `1px solid ${palette.alpha(ink(), 0.4)}`,
          "background-color": palette.alpha(ink(), 0.12),
          color: ink(),
        }}
      >
        {props.icon ?? fallbackGlyph()}
      </Box>
      <div
        class={cn(
          "flex flex-wrap min-w-0",
          row() ? "items-baseline gap-x-1.5 gap-y-0.5" : "flex-col items-center gap-1",
        )}
        style={{
          display: "flex",
          "min-width": 0,
          "align-items": row() ? "baseline" : "center",
          gap: row() ? "6px 6px" : "4px",
          "flex": row() ? "1 1 auto" : "0 0 auto",
          "flex-wrap": "wrap",
        }}
      >
        <Text
          span
          fw={600}
          className="min-w-0 shrink-0"
          style={{
            "font-size": `${typeSize("micro")}px`,
            "line-height": "1.25",
            color: palette.TEXT,
            "white-space": "nowrap",
          }}
        >
          {title()}
        </Text>
        <Show when={description()}>
          <Text
            span
            data-testid={props.descriptionTestId}
            // One flowing line when the band is wide (the 1764px rail), wraps
            // internally when it is narrow (the 420px heatmap pane) — the same
            // element, no second layout branch.
            className="min-w-0"
            style={{
              "font-size": `${typeSize("micro")}px`,
              "line-height": "1.35",
              "flex": "0 1 auto",
              "max-width": row() ? undefined : "46ch",
              color: palette.TEXT_MUTED,
              "white-space": "normal",
            }}
          >
            {description()}
          </Text>
        </Show>
        <Show when={props.hint}>
          <Text
            span
            className="shrink-0"
            style={{
              "font-size": `${typeSize("micro")}px`,
              "line-height": "1.35",
              color: palette.TEXT_MUTED,
              "white-space": "nowrap",
            }}
          >
            {props.hint}
          </Text>
        </Show>
        <Show when={props.action}>
          <div class="shrink-0" style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            {props.action}
          </div>
        </Show>
      </div>
    </div>
  );
}

interface ErrorAlertProps {
  title?: string;
  message: string;
  onClose?: () => void;
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
  withRetry?: boolean;
  onRetry?: () => void;
}

export function ErrorAlert(props: ErrorAlertProps) {
  const testId = () => props["data-testid"] ?? props.dataTestid;
  return (
    <Alert
      icon={<IconAlertCircle size="1rem" />}
      title={props.title ?? "Error"}
      color="error"
      variant="filled"
      withCloseButton={!!props.onClose}
      onClose={props.onClose}
      data-testid={testId()}
      className={cn("mb-4", props.className)}
    >
      {props.message}
      <Show when={props.withRetry && props.onRetry}>
        <Button
          variant="filled"
          color="error"
          size="sm"
          onClick={props.onRetry}
          className="mt-1"
          data-testid={testId() ? `${testId()}-retry` : undefined}
        >
          Retry
        </Button>
      </Show>
    </Alert>
  );
}

interface EmptyCompactProps {
  icon?: JSX.Element;
  emoji?: string;
  title: string;
  description?: string;
  "data-testid"?: string;
  /** @deprecated kebab-case `data-testid` is the supported spelling. */
  dataTestid?: string;
  className?: string;
  id?: string;
  children?: JSX.Element;
}

export function EmptyCompact(props: EmptyCompactProps) {
  return (
    <CompactPanel data-testid={props["data-testid"] ?? props.dataTestid} className={props.className} id={props.id} description={props.description}>
      <EmptyState icon={props.icon} emoji={props.emoji} title={props.title} />
      {props.children}
    </CompactPanel>
  );
}
