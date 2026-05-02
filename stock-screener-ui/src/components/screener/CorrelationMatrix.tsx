import { CorrelationHeatmap } from "../common/CorrelationHeatmap";

interface CorrelationMatrixProps {
  matrix: number[][];
  symbols: string[];
  isLoading?: boolean;
}

export function CorrelationMatrix({ matrix, symbols, isLoading }: CorrelationMatrixProps) {
  return (
    <CorrelationHeatmap
      matrix={matrix}
      symbols={symbols}
      isLoading={isLoading}
      testId="correlation-matrix"
      valueFormatter={(v) => v.toFixed(2)}
    />
  );
}
