import { CorrelationHeatmap } from "../common/CorrelationHeatmap";

interface CorrelationMatrixProps {
  matrix: number[][];
  symbols: string[];
  isLoading?: boolean;
}

export function CorrelationMatrix(props: CorrelationMatrixProps) {
  return (
    <CorrelationHeatmap
      matrix={props.matrix}
      symbols={props.symbols}
      isLoading={props.isLoading}
      testId="correlation-matrix"
      valueFormatter={(v: number) => v.toFixed(2)}
    />
  );
}
