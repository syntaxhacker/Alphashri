import type { RotationRow } from "@/types/rotation";
import { MultiPeriodHeatmap } from "./rotation/MultiPeriodHeatmap";

export interface RotationMatrixProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RotationMatrix(props: RotationMatrixProps) {
  return (
    <MultiPeriodHeatmap
      rows={props.rows}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
    />
  );
}
