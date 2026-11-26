import { For } from "solid-js";
import { Box } from "@/ui";
import {
  IconChartBar,
  IconArrowsExchange,
  IconNetwork,
} from "../screener/icons";
import { IconHistory } from "../common/Icons";

export const SECTOR_SECTIONS = [
  { id: "overview", label: "Overview", icon: () => <IconChartBar size={12} /> },
  { id: "rotation", label: "Rotation", icon: () => <IconArrowsExchange size={12} /> },
  { id: "correlation", label: "Correlation", icon: () => <IconNetwork size={12} /> },
  { id: "history", label: "History", icon: () => <IconHistory size={12} /> },
] as const;

export type SectorSectionId = (typeof SECTOR_SECTIONS)[number]["id"];

export function isSectorSectionId(value: string | null | undefined): value is SectorSectionId {
  return value != null && SECTOR_SECTIONS.some((section) => section.id === value);
}

export function SectorSectionNav(props: {
  active: SectorSectionId;
  onNavigate: (id: SectorSectionId) => void;
}) {
  return (
    <Box
      component="nav"
      aria-label="Sector sections"
      data-testid="sector-section-nav"
      className="sticky top-0 z-20 flex h-8 shrink-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-fin-border bg-fin-bg px-1"
    >
      <For each={SECTOR_SECTIONS}>
        {(section) => (
          <a
            href={`#${section.id}`}
            data-testid={`sector-nav-${section.id}`}
            aria-current={props.active === section.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              props.onNavigate(section.id);
            }}
            className={
              `inline-flex h-[24px] shrink-0 items-center gap-1 rounded-[2px] px-2 text-ui-micro font-semibold no-underline ` +
              `focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-text ` +
              (props.active === section.id
                ? "bg-fin-primary/20 text-fin-primary"
                : "text-fin-text-muted hover:bg-fin-primary/10 hover:text-fin-text")
            }
          >
            {section.icon()}
            <span class="text-ui-micro">{section.label}</span>
          </a>
        )}
      </For>
    </Box>
  );
}
