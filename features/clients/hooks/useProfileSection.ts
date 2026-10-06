import { useCallback, useEffect, useRef, useState } from 'react';

export type ProfileSectionState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error' };

/**
 * Loads one independent profile card. A failing card shows its own error and
 * retry without blocking the rest of the page. `refreshToken` changes trigger
 * a quiet reload that keeps the previous data visible.
 */
export const useProfileSection = <T>(loader: () => Promise<T>, refreshToken: number) => {
  const [state, setState] = useState<ProfileSectionState<T>>({ status: 'loading' });
  const versionRef = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async (quiet: boolean) => {
    const version = ++versionRef.current;
    if (!quiet) setState({ status: 'loading' });
    try {
      const data = await loaderRef.current();
      if (version === versionRef.current) setState({ status: 'success', data });
    } catch (error) {
      console.error('Client profile section failed to load.', error instanceof Error ? error.name : 'unknown');
      if (version === versionRef.current) setState((current) => (quiet && current.status === 'success' ? current : { status: 'error' }));
    }
  }, []);

  // A new loader (e.g. another client) reloads visibly; a new refreshToken reloads quietly.
  const lastLoader = useRef<(() => Promise<T>) | null>(null);
  useEffect(() => {
    const quiet = lastLoader.current === loader;
    lastLoader.current = loader;
    void load(quiet);
  }, [load, loader, refreshToken]);

  useEffect(() => () => { versionRef.current += 1; }, []);

  return { state, reload: () => load(false) };
};
