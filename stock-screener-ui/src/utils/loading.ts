export type LoadingState<T extends string> = Record<T, boolean>;

export function createLoadingState<T extends string>(keys: T[]): LoadingState<T> {
  return keys.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as LoadingState<T>);
}

export function setLoading<T extends string>(
  state: LoadingState<T>,
  key: T,
  isLoading: boolean,
): LoadingState<T> {
  return { ...state, [key]: isLoading };
}

export function isLoading<T extends string>(state: LoadingState<T>, key: T): boolean {
  return state[key] ?? false;
}

export function isAnyLoading<T extends string>(state: LoadingState<T>): boolean {
  return Object.values(state).some((v) => v);
}
