import { createEffect, createSignal, Show } from "solid-js";
import { Box, Text } from "@/ui";
import { PATTERN_LABELS } from "@/config/patternCatalog";

export interface PatternImageProps {
  patternId: string;
  images: Record<string, string>;
  alt?: string;
  height?: number;
  showPlaceholderLabel?: boolean;
}

function PatternPlaceholder(props: { label: string; showLabel: boolean }) {
  return (
    <Box
      data-testid="pattern-image-placeholder"
      className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-fin border border-dashed border-fin-border bg-fin-surface-alt px-2"
    >
      <svg
        viewBox="0 0 96 40"
        aria-hidden="true"
        className="h-auto w-full max-w-[120px] text-fin-primary"
      >
        <polyline
          points="2,34 18,20 30,26 48,10 64,18 78,6 94,12"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <line
          x1="2"
          y1="38"
          x2="94"
          y2="38"
          stroke="var(--color-fin-border)"
          stroke-width="1"
        />
      </svg>
      <Text
        size="xs"
        c="dimmed"
        ta="center"
        lineClamp={2}
        data-testid="pattern-image-placeholder-label"
        style={{ display: props.showLabel ? undefined : "none" }}
      >
        {props.label}
      </Text>
    </Box>
  );
}

export function PatternImage(props: PatternImageProps) {
  const [errored, setErrored] = createSignal(false);

  const url = () => props.images[props.patternId];
  const height = () => props.height ?? 120;
  const showPlaceholderLabel = () => props.showPlaceholderLabel ?? true;

  createEffect(() => {
    url();
    setErrored(false);
  });

  const label = () => props.alt ?? PATTERN_LABELS[props.patternId] ?? props.patternId;

  return (
    <Show when={url() && !errored()} fallback={
      <Box className="w-full" style={{ height: `${height()}px` }}>
        <PatternPlaceholder label={label()} showLabel={showPlaceholderLabel()} />
      </Box>
    }>
      <img
        src={url()}
        alt={label()}
        data-testid={`pattern-image-${props.patternId}`}
        onError={() => setErrored(true)}
        className="block w-full rounded-fin bg-fin-surface-alt object-contain"
        style={{ height: `${height()}px` }}
      />
    </Show>
  );
}
