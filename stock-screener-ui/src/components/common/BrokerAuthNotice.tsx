/**
 * Every options surface renders this component when — and only when — the typed
 * API error says `kind: "auth" | "unauthorized"`. Nothing here reads a token, a
 * status boolean or an error message, so a panel can never claim "connected"
 * while a 401 is on screen (or show this state for a 500).
 */

import { Anchor, Group, Text } from "@/ui";

export const BROKER_AUTH_MESSAGE = "Upstox connection required — reconnect in Settings";
export const BROKER_AUTH_ACTION = "Open Settings";
export const BROKER_AUTH_HREF = "/settings";
export const BROKER_AUTH_MESSAGE_TESTID = "broker-auth-message";

/** The typed error kind is the only signal; never string-match an error message. */
export function isBrokerAuthKind(kind: string | null | undefined): boolean {
  return kind === "auth" || kind === "unauthorized";
}

interface BrokerAuthNoticeProps {
  /** Existing per-surface link testid (`options-chain-connect`, etc.). */
  connectTestId: string;
  messageTestId?: string;
  size?: "xs" | "sm";
}

export function BrokerAuthNotice(props: BrokerAuthNoticeProps) {
  const size = () => props.size ?? "xs";
  return (
    <Group gap={8} align="center">
      <Text size={size()} data-testid={props.messageTestId ?? BROKER_AUTH_MESSAGE_TESTID}>
        {BROKER_AUTH_MESSAGE}
      </Text>
      <Anchor href={BROKER_AUTH_HREF} size={size()} c="primary" data-testid={props.connectTestId}>
        {BROKER_AUTH_ACTION}
      </Anchor>
    </Group>
  );
}
