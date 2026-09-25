/**
 * React hooks for data fetching and state management
 */

import { useState, useEffect, useCallback } from 'react';
import type { Fleet, Pack, KnowledgeObject, FetchError } from './types';
import { ApiError } from './api';
import * as api from './api';

interface UseAsyncState<T> {
  data: T | null;
  loading: boolean;
  error: FetchError | null;
}

type UseAsyncResult<T> = UseAsyncState<T> & {
  retry: () => void;
};

/**
 * Generic hook for async data fetching with loading/error states
 */
export function useAsync<T>(
  fetchFn: () => Promise<T>,
  dependencies: unknown[] = []
): UseAsyncResult<T> {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState({ data: null, loading: true, error: null });
    try {
      const result = await fetchFn();
      setState({ data: result, loading: false, error: null });
    } catch (err) {
      const error: FetchError = {
        status: err instanceof ApiError ? err.status : 500,
        message: err instanceof Error ? err.message : 'Unknown error',
        details: err instanceof ApiError ? err.details : undefined,
      };
      setState({ data: null, loading: false, error });
    }
  }, [fetchFn]);

  useEffect(() => {
    fetchData();
  }, dependencies);

  return {
    ...state,
    retry: fetchData,
  };
}

export function useFleets() {
  return useAsync(() => api.fetchGroups('stream'));
}

export function useFleet(fleetId: string) {
  return useAsync(
    () => api.fetchGroup(fleetId, 'stream'),
    [fleetId]
  );
}

export function usePacks() {
  return useAsync(() => api.fetchPacks());
}

export function usePack(packId: string) {
  return useAsync(
    () => api.fetchPack(packId),
    [packId]
  );
}

export function useFleetPacks(fleetId: string) {
  return useAsync(
    () => api.fetchFleetPacks(fleetId, 'stream'),
    [fleetId]
  );
}

export function usePackKnowledgeObjects(packId: string | null) {
  return useAsync(
    () => (packId ? api.fetchPackKnowledgeObjects(packId) : Promise.resolve([])),
    [packId]
  );
}
