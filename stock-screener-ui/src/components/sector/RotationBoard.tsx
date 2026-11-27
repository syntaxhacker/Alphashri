import type { RotationPeriod, RotationRow } from "@/types/rotation";
import { RankedBoard } from "./rotation/RankedBoard";

export interface RotationBoardProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  period: RotationPeriod;
}

export function RotationBoard(props: RotationBoardProps) {
  return (
    <RankedBoard
      rows={props.rows}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      period={props.period}
    />
  );
}
