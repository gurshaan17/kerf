import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { KerfBridge } from '../../shared/contracts';
import {
  createStudioStore,
  useStudio as useStudioStore,
  type StudioState,
  type StudioStore,
} from './studio';

const StudioContext = createContext<StudioStore | null>(null);

export interface StudioProviderProps {
  readonly bridge: KerfBridge;
  readonly children: ReactNode;
}

export function StudioProvider({ bridge, children }: StudioProviderProps) {
  const storeRef = useRef<StudioStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createStudioStore(bridge);
  }
  const store = storeRef.current;

  useEffect(() => {
    void store.getState().hydrate();
    const unsubscribe = bridge.events.subscribe((event) => {
      store.getState().handleEvent(event);
    });
    return unsubscribe;
  }, [bridge, store]);

  return (
    <StudioContext.Provider value={store}>{children}</StudioContext.Provider>
  );
}

export function useStudioStoreApi(): StudioStore {
  const store = useContext(StudioContext);
  if (!store) {
    throw new Error('Studio components must render inside StudioProvider.');
  }
  return store;
}

export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useStudioStore(useStudioStoreApi(), selector);
}
