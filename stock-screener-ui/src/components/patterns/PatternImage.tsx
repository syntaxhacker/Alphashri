import { useEffect, useState } from "react";
import { Box, Text } from "@/ui";
import { PATTERN_LABELS } from "@/config/patternCatalog";

export interface PatternImageProps {
  /** Backend `pattern_id` whose image should be shown. */
  patternId: string;
  /** Map of `pattern_id` → public image URL (from `fetchPatternImages`). */
  images: Record<string, string>;
  /** Optional alt text; defaults to the catalog name / pattern id. */
  alt?: string;
  /** Rendered height in px. Defaults to 120. */
  height?: number;
  /** Show the pattern name inside the no-image placeholder (default true). */
  showPlaceholderLabel?: boolean;
}

/** Compact inline SVG shown when a pattern has no uploaded image. */
function PatternPlaceholder({ label, showLabel }: { label: string; showLabel: boolean }) {
  return (
    <Box
      data-testid="pattern-image-placeholder"
      className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-fin border border-dashed border-fin-border bg-fin-surface-alt px-2"
    >
      <Box
        component="svg"
        viewBox="0 0 96 40"
        aria-hidden="true"
        className="h-auto w-full max-w-[120px] text-fin-primary"
      >
        <polyline
          points="2,34 18,20 30,26 48,10 64,18 78,6 94,12"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1="2"
          y1="38"
          x2="94"
          y2="38"
          stroke="var(--color-fin-border)"
          stroke-width="1"
        />
      </Box>
      <Text
        size="xs"
        c="dimmed"
        ta="center"
        lineClamp={2}
        data-testid="pattern-image-placeholder-label"
        style={{ display: showLabel ? undefined : "none" }}
      >
        {label}
      </Text>
    </Box>
  );
}

/**
 * Render the uploaded reference image for a pattern, falling back to a compact
 * SVG placeholder when there is no image (or the image fails to load).
 */
export function PatternImage({
  patternId,
  images,
  alt,
  height = 120,
  showPlaceholderLabel = true,
}: PatternImageProps) {
  const url = images[patternId];
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [url]);

  const label = alt ?? PATTERN_LABELS[patternId] ?? patternId;

  if (url && !errored) {
    return (
      <Box
        component="img"
        src={url}
        alt={label}
        data-testid={`pattern-image-${patternId}`}
        onError={() => setErrored(true)}
        className="block w-full rounded-fin bg-fin-surface-alt object-contain"
        style={{ height }}
      />
    );
  }

  return (
    <Box className="w-full" style={{ height }}>
      <PatternPlaceholder label={label} showLabel={showPlaceholderLabel} />
    </Box>
  );
}
