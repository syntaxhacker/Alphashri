import { Progress as MantineProgress, ProgressSection, ProgressLabel } from "@mantine/core";
import type { UIProgressProps } from "../types";

export function Progress({ value, color, size, radius, striped, animated, label, sections, transitionDuration, className, style, "data-testid": testId }: UIProgressProps) {
  if (sections && sections.length > 0) {
    return (
      <MantineProgress value={0} size={size} radius={radius} className={className} style={style} data-testid={testId}>
        {sections.map((section, i) => (
          <ProgressSection key={i} value={section.value} color={section.color} striped={striped} animated={animated}>
            {(label || section.label) && <ProgressLabel>{section.label ?? label}</ProgressLabel>}
          </ProgressSection>
        ))}
      </MantineProgress>
    );
  }
  return (
    <MantineProgress value={value} color={color} size={size} radius={radius} striped={striped} animated={animated} transitionDuration={transitionDuration} className={className} style={style} data-testid={testId}>
      {label && <ProgressLabel>{label}</ProgressLabel>}
    </MantineProgress>
  );
}
