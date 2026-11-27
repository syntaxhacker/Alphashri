import { Text } from "@/ui";
import { cn } from "@/ui/cn";

export interface ScrollSidewaysCueProps {
  testId?: string;
  className?: string;
  label?: string;
}

/** Narrow-viewport affordance for the horizontally scrollable pattern regions. */
export function ScrollSidewaysCue(props: ScrollSidewaysCueProps) {
  return (
    <Text
      data-testid={props.testId ?? "patterns-scroll-sideways-cue"}
      c="dimmed"
      className={cn(
        "flex w-max shrink-0 items-center gap-1 whitespace-nowrap text-ui-micro leading-none md:hidden",
        props.className,
      )}
    >
      {props.label ?? "Scroll sideways →"}
    </Text>
  );
}
