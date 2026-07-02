import { Box, Tooltip, ActionIcon } from "@/ui";
import { IconTarget, IconArrowUp, IconArrowDown } from "@tabler/icons-react";

interface ChainScrollActionsProps {
  scrollToATM: (behavior?: ScrollBehavior) => void;
  scrollToEdge: (direction: "top" | "bottom") => void;
}

export function ChainScrollActions({ scrollToATM, scrollToEdge }: ChainScrollActionsProps) {
  return (
    <Box
      className="chain-scroll-actions"
      style={{
        position: "absolute",
        right: 20,
        bottom: 80,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      data-testid="options-chain-scroll-actions"
    >
      <Tooltip label="Scroll to Top" position="left">
        <ActionIcon
          variant="light"
          color="gray"
          size="lg"
          radius="xl"
          onClick={() => scrollToEdge("top")}
          className="scroll-action-btn"
          data-testid="options-scroll-top-btn"
        >
          <IconArrowUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Jump to ATM" position="left">
        <ActionIcon
          variant="filled"
          color="yellow"
          size="xl"
          radius="xl"
          onClick={() => scrollToATM("smooth")}
          style={{ boxShadow: "var(--mantine-shadow-md)" }}
          className="scroll-action-btn scroll-atm-btn"
          data-testid="options-scroll-atm-btn"
        >
          <IconTarget size={22} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Scroll to Bottom" position="left">
        <ActionIcon
          variant="light"
          color="gray"
          size="lg"
          radius="xl"
          onClick={() => scrollToEdge("bottom")}
          className="scroll-action-btn"
          data-testid="options-scroll-bottom-btn"
        >
          <IconArrowDown size={18} />
        </ActionIcon>
      </Tooltip>
    </Box>
  );
}
