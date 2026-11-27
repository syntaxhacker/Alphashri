import { createContext, useContext, type JSX } from "solid-js";

import { createNiftyReportStore, startNiftyReportEffects } from "./niftyReportStore";
import type { NiftyReportStore } from "./niftyReportStore";

const NiftyReportContext = createContext<NiftyReportStore | null>(null);

export function ReportProvider(props: {
  onOpenSymbol?: (symbol: string) => void;
  children: JSX.Element;
}) {
  const store = createNiftyReportStore({
    onOpenSymbol: (symbol) => props.onOpenSymbol?.(symbol),
  });
  startNiftyReportEffects(store);
  return (
    <NiftyReportContext.Provider value={store}>{props.children}</NiftyReportContext.Provider>
  );
}

export function useNiftyReport(): NiftyReportStore {
  const store = useContext(NiftyReportContext);
  if (!store) {
    throw new Error("useNiftyReport() must be called inside a <ReportProvider>");
  }
  return store;
}
