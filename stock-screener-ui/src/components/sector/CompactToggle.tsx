import { For } from "solid-js";
import { Box, cn } from "@/ui";

export interface CompactToggleProps {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  testId: string;
  label?: string;
}

/** 22px two-button switch — the dense control used by every sector band. */
export function CompactToggle(props: CompactToggleProps) {
  return (
    <Box
      data-testid={props.testId}
      role="group"
      aria-label={props.label}
      className="flex h-[22px] shrink-0 overflow-hidden rounded-[1px] border border-fin-border"
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.value === option.value ? "true" : "false"}
            onClick={() => props.onChange(option.value)}
            class={cn(
              "cursor-pointer border-0 px-[6px] text-[9.5px] font-semibold leading-none",
              "bg-transparent text-fin-text-muted hover:bg-fin-primary/10",
            )}
            classList={{
              "bg-fin-primary/10 text-fin-primary": props.value === option.value,
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </Box>
  );
}