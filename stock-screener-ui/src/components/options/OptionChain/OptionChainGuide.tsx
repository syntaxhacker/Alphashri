import { Modal, Text, Badge, List, ListItem } from "@/ui";
import { Box, Paper, Stack } from "@/ui";
import { IconTarget } from "@/patterns/icons";
import * as palette from "@/ui/palette";

interface OptionChainGuideProps {
  opened: boolean;
  onClose: () => void;
}

export function OptionChainGuide(props: OptionChainGuideProps) {
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="How to Read the Option Chain"
      size="lg"
      centered
      style={{ borderRadius: 8 }}
      className="option-chain-guide-modal"
      data-testid="options-chain-guide-modal"
    >
      <Stack spacing={1} className="flex items-center w-full guide-content" data-testid="options-guide-content">
        <Text size="sm" className="text-fin-text-muted guide-intro" style={{ textAlign: "center" }}>
          Options can be complex. Here is a simple guide to help you understand the data and make better decisions.
        </Text>

        <Box className="flex items-center justify-center w-full" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={700}>
            The Basics
          </Text>
        </Box>

        <Box className="flex flex-wrap gap-[8px]" data-testid="options-guide-basics">
          <Box style={{ width: "calc(50% - 4px)" }} className="flex justify-center">
            <Paper p={1} w="100%" className="guide-card guide-card-calls">
              <Box p={1}>
                <Text fw={700} size="sm" className="text-fin-positive">
                  CALLS (CE)
                </Text>
                <Text size="sm">
                  Right to buy. Traders buy CE if they expect the price to <strong>GO UP</strong>.
                </Text>
              </Box>
            </Paper>
          </Box>
          <Box style={{ width: "calc(50% - 4px)" }} className="flex justify-center">
            <Paper p={1} w="100%" className="guide-card guide-card-puts">
              <Box p={1}>
                <Text fw={700} size="sm" className="text-fin-negative">
                  PUTS (PE)
                </Text>
                <Text size="sm">
                  Right to sell. Traders buy PE if they expect the price to <strong>GO DOWN</strong>.
                </Text>
              </Box>
            </Paper>
          </Box>
        </Box>

        <Box className="flex items-center justify-center w-full" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={700}>
            Key Indicators
          </Text>
        </Box>

        <List spacing="xs" size="sm" className="guide-indicators" data-testid="options-guide-indicators">
          <ListItem className="guide-indicator-item" data-testid="options-guide-pcr">
            <Text component="span" fw={700}>PCR (Put-Call Ratio):</Text> If {">"} 1.2, more puts are being sold (Bullish). If {"<"} 0.7, more calls are being sold (Bearish).
          </ListItem>
          <ListItem className="guide-indicator-item" data-testid="options-guide-max-pain">
            <Text component="span" fw={700}>Max Pain:</Text> The price level where option buyers lose the most money. Market often tends to gravitate towards this level on expiry.
          </ListItem>
          <ListItem className="guide-indicator-item" data-testid="options-guide-oi">
            <Text component="span" fw={700}>Open Interest (OI):</Text> The total number of open contracts. High OI acts as a "Wall" (Support or Resistance).
          </ListItem>
        </List>

        <Box className="flex items-center justify-center w-full" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={700}>
            Sentiment Badges (What are they doing?)
          </Text>
        </Box>

        <Stack spacing={1} className="w-full items-center" data-testid="options-guide-badges">
          <Box className="flex items-center gap-[8px] justify-center" data-testid="options-guide-badge-lb">
            <Badge color="success" variant="light" style={{ width: 80 }}>
              LB
            </Badge>
            <Text size="sm" fw={700}>
              Long Buildup:
            </Text>
            <Text size="sm">
              New buyers entering. <strong>Strong Bullish signal.</strong>
            </Text>
          </Box>
          <Box className="flex items-center gap-[8px] justify-center" data-testid="options-guide-badge-sb">
            <Badge color="error" variant="light" style={{ width: 80 }}>
              SB
            </Badge>
            <Text size="sm" fw={700}>
              Short Buildup:
            </Text>
            <Text size="sm">
              Sellers creating new positions. <strong>Strong Bearish signal.</strong>
            </Text>
          </Box>
          <Box className="flex items-center gap-[8px] justify-center" data-testid="options-guide-badge-sc">
            <Badge color="info" variant="light" style={{ width: 80 }}>
              SC
            </Badge>
            <Text size="sm" fw={700}>
              Short Covering:
            </Text>
            <Text size="sm">
              Sellers closing positions. <strong>Price usually bounces up.</strong>
            </Text>
          </Box>
          <Box className="flex items-center gap-[8px] justify-center" data-testid="options-guide-badge-lu">
            <Badge color="warning" variant="light" style={{ width: 80 }}>
              LU
            </Badge>
            <Text size="sm" fw={700}>
              Long Unwinding:
            </Text>
            <Text size="sm">
              Buyers closing positions. <strong>Price usually profit books (down).</strong>
            </Text>
          </Box>
        </Stack>

        <Paper p={1} w="100%" className="guide-pro-tip" data-testid="options-guide-pro-tip">
          <Box p={1}>
            <Box className="flex items-center gap-[8px] justify-center">
              <IconTarget size={20} color={palette.PRIMARY} />
              <Text size="sm" fw={600} className="text-fin-primary">
                PRO TIP: Look for strikes where both OI and Volume are spiking with an "LB" badge—that's where the next big move might happen!
              </Text>
            </Box>
          </Box>
        </Paper>
      </Stack>
    </Modal>
  );
}
