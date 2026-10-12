import { useEffect, useState } from "react";
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

export function SymbolAvatar({ symbol, name, logo, size = 20 }: SymbolAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logo, symbol]);

  const showImg = logo != null && logo !== "" && !failed;

  return (
    <Box
      data-testid="symbol-avatar"
      data-symbol={symbol}
      data-fallback={showImg ? undefined : "initials"}
      title={name || symbol}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      sx={{
        borderRadius: "50%",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        bgcolor: showImg ? "action.hover" : tintFor(symbol),
      }}
    >
      {showImg ? (
        <img
          src={logo as string}
          alt={symbol}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          style={{ width: size, height: size, objectFit: "contain", display: "block" }}
        />
      ) : (
        <Text size="xs" span fw={700} sx={{ fontSize: size * 0.45, color: TEXT, lineHeight: 1 }}>
          {initialsFor(symbol)}
        </Text>
      )}
    </Box>
  );
}
