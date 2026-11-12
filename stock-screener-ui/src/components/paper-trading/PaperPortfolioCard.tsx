import { Show } from "solid-js";
import { Text } from "@/ui";
import { formatNumber, formatSignedPnl, getPnLTextColor } from "../../utils/ui-helpers";

export interface Portfolio {
  total_value: number;
  cash: number;
  margin_used: number;
  day_pnl: number;
  positions_count: number;
  available_margin?: number;
}

interface PaperPortfolioCardProps {
  portfolio: Portfolio | null;
}

export function PaperPortfolioCard(props: PaperPortfolioCardProps) {
  const pnlColor = () => props.portfolio ? getPnLTextColor(props.portfolio.day_pnl) : "dimmed";

  return (
    <Show
      when={props.portfolio}
      fallback={
        <Text c="dimmed" size="xs" data-testid="portfolio-card">
          Loading...
        </Text>
      }
    >
      {(portfolio) => (
        <div class="flex items-center gap-2 px-2 py-1 flex-wrap" data-testid="portfolio-card" id="portfolio-card">
          <Text size="xs" c="dimmed">
            Val <span class="font-mono tabular-nums">₹{formatNumber(portfolio().total_value)}</span>
          </Text>
          <Text size="xs" c="dimmed">
            Cash <span class="font-mono tabular-nums">₹{formatNumber(portfolio().cash)}</span>
          </Text>
          <Text size="xs" c="dimmed">
            Mrgn <span class="font-mono tabular-nums">₹{formatNumber(portfolio().margin_used)}</span>
          </Text>
          <Text size="xs" c={pnlColor()} fw={500} className="font-mono tabular-nums">
            {formatSignedPnl(portfolio().day_pnl)}
          </Text>
        </div>
      )}
    </Show>
  );
}
