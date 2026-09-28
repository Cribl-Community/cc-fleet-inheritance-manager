/**
 * React hooks for data fetching and state management
 */

import { useCallback, useEffect, useState } from 'react';
import type { FetchError, FleetProduct, KnowledgeObject, PackKnowledgeInventory, PackUsageLocation } from './types';
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
): UseAsyncResult<T> {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));

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
    void fetchData();
  }, [fetchData]);

  return {
    ...state,
    retry: fetchData,
  };
}

export function useFleets() {
  const fetchFn = useCallback(() => api.fetchAllFleets(), []);

  return useAsync(fetchFn);
}

export function useFleet(fleetId: string, product: FleetProduct) {
  const fetchFn = useCallback(() => api.fetchGroup(fleetId, product), [fleetId, product]);

  return useAsync(fetchFn);
}

export function usePacks() {
  const fetchFn = useCallback(() => api.fetchPacks(), []);

  return useAsync(fetchFn);
}

export function usePackRelationshipSummaries() {
  const fetchFn = useCallback(() => api.fetchPackRelationshipSummaries(), []);

  return useAsync(fetchFn);
}

export function usePack(packId: string) {
  const fetchFn = useCallback(() => api.fetchPack(packId), [packId]);

  return useAsync(fetchFn);
}

export function useFleetPacks(fleetId: string, product: FleetProduct) {
  const fetchFn = useCallback(() => api.fetchFleetPacks(fleetId, product), [fleetId, product]);

  return useAsync(fetchFn);
}

export function usePackKnowledgeObjects(packId: string | null, groupId?: string) {
  const fetchFn = useCallback(
    () => (packId ? api.fetchPackKnowledgeObjects(packId, groupId) : Promise.resolve([])),
    [groupId, packId],
  );

  return useAsync(fetchFn);
}

export function usePackKnowledgeObjectInventories(
  packId: string | null,
  usageLocations: PackUsageLocation[],
) {
  const fetchFn = useCallback(async () => {
    if (!packId || usageLocations.length === 0) {
      return new Map<string, PackKnowledgeInventory>();
    }

    // Each fleet is read on its own so one unreadable fleet does not hide the others.
    const entries = await Promise.all(
      usageLocations.map(async (usageLocation): Promise<readonly [string, PackKnowledgeInventory]> => {
        const key = `${usageLocation.product}:${usageLocation.fleetId}`;

        try {
          return [
            key,
            await api.fetchPackKnowledgeInventory(
              packId,
              usageLocation.fleetId,
              usageLocation.inheritedFrom ?? usageLocation.parentFleetId,
            ),
          ] as const;
        } catch (error) {
          return [
            key,
            { objects: [], failedTypes: [], error: error instanceof Error ? error.message : String(error) },
          ] as const;
        }
      }),
    );

    return new Map<string, PackKnowledgeInventory>(entries);
  }, [packId, usageLocations]);

  return useAsync(fetchFn);
}

export function useKnowledgeObjectPreview(
  packId: string | null,
  knowledgeObject: KnowledgeObject | null,
  groupId?: string,
) {
  const fetchFn = useCallback(
    () => (packId && knowledgeObject ? api.fetchKnowledgeObjectPreview(packId, knowledgeObject, groupId) : Promise.resolve(null)),
    [groupId, knowledgeObject, packId],
  );

  return useAsync(fetchFn);
}
