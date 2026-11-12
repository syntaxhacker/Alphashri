import { createSignal, createEffect, Show } from "solid-js";
import { Box, Text } from "@/ui";
import { SCALE_BLUE, SCALE_CYAN, SCALE_GREEN, SCALE_ORANGE, SCALE_PINK, SCALE_VIOLET, TEXT } from "@/ui/palette";

interface SymbolAvatarProps {
  symbol: string;
  name?: string;
  logo?: string | null;
  size?: number;
}

// Short tint list drawn from palette tokens only (no hardcoded hex).
const AVATAR_TINTS = [
  SCALE_BLUE[6],
  SCALE_GREEN[6],
  SCALE_VIOLET[5],
  SCALE_ORANGE[5],
  SCALE_CYAN[5],
  SCALE_PINK[5],
];

function initialsFor(symbol: string): string {
  const letters = (symbol || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.length >= 2) return letters.slice(0, 2);
  if (letters.length === 1) return letters;
  return (symbol || "?").slice(0, 2).toUpperCase() || "?";
}

function tintFor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

export function SymbolAvatar(props: SymbolAvatarProps) {
  const [failed, setFailed] = createSignal(false);

  // Reset the failure latch whenever the logo or symbol changes.
  createEffect(() => {
    void props.logo;
    void props.symbol;
    setFailed(false);
  });

  const showImg = () => props.logo != null && props.logo !== "" && !failed();
  const size = () => props.size ?? 20;

  return (
    <Box
      data-testid="symbol-avatar"
      data-symbol={props.symbol}
      data-fallback={showImg() ? undefined : "initials"}
      title={props.name || props.symbol}
      className="inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "min-width": `${size()}px`,
        "min-height": `${size()}px`,
        "background-color": showImg() ? "var(--color-fin-surface-alt)" : tintFor(props.symbol),
      }}
    >
      <Show
        when={showImg()}
        fallback={
          <Text size="xs" span fw={700} style={{ "font-size": `${size() * 0.45}px`, color: TEXT, "line-height": 1 }}>
            {initialsFor(props.symbol)}
          </Text>
        }
      >
        <img
          src={props.logo as string}
          alt={props.symbol}
          width={size()}
          height={size()}
          onError={() => setFailed(true)}
          style={{ width: `${size()}px`, height: `${size()}px`, "object-fit": "contain", display: "block" }}
        />
      </Show>
    </Box>
  );
}
