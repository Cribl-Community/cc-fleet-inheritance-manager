/**
 * Cribl API Integration Layer
 * Provides typed fetch wrappers for Fleet, Pack, and KnowledgeObject data
 */

import type { Fleet, Pack, KnowledgeObject, PaginatedResponse, FetchError } from './types';

const BASE_URL = typeof window !== 'undefined' ? window.CRIBL_API_URL : '/api/v1';

class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error: FetchError = {
      status: response.status,
      message: `API error: ${response.statusText}`,
    };
    try {
      const body = await response.json();
      error.message = body.message || error.message;
      error.details = body.details || body;
    } catch {
      // Could not parse JSON, use status text
    }
    throw new ApiError(error.message, response.status, error.details);
  }

  return response.json() as Promise<T>;
}

/**
 * Fetches all groups (Fleets) for a given product
 * Using the modern /products/{product}/groups endpoint
 */
export async function fetchGroups(product: string = 'stream'): Promise<Fleet[]> {
  try {
    const response = await fetch(`${BASE_URL}/products/${product}/groups`);
    const data = await handleResponse<PaginatedResponse<any>>(response);

    if (Array.isArray(data.items)) {
      return data.items.map((item: any) => ({
        id: item.id || item._id,
        name: item.name || item.displayName,
        description: item.description,
        type: item.type,
        deployedVersion: item.deployedConfigVersion,
        lastDeployTime: item.lastDeployTime,
        lastConfigTime: item.lastUpdateTime,
      })) as Fleet[];
    }

    return [];
  } catch (error) {
    console.error('Failed to fetch groups:', error);
    throw error;
  }
}

/**
 * Fetches a specific group/fleet by ID
 */
export async function fetchGroup(groupId: string, product: string = 'stream'): Promise<Fleet> {
  try {
    const response = await fetch(`${BASE_URL}/products/${product}/groups/${groupId}`);
    const data = await handleResponse<any>(response);

    return {
      id: data.id || data._id,
      name: data.name || data.displayName,
      description: data.description,
      type: data.type,
      deployedVersion: data.deployedConfigVersion,
      lastDeployTime: data.lastDeployTime,
      lastConfigTime: data.lastUpdateTime,
    } as Fleet;
  } catch (error) {
    console.error(`Failed to fetch group ${groupId}:`, error);
    throw error;
  }
}

/**
 * Fetches all packs available in the system
 */
export async function fetchPacks(): Promise<Pack[]> {
  try {
    const response = await fetch(`${BASE_URL}/packs`);
    const data = await handleResponse<PaginatedResponse<any>>(response);

    if (Array.isArray(data.items)) {
      return data.items.map((item: any) => ({
        id: item.id,
        displayName: item.displayName || item.name,
        description: item.description,
        version: item.version,
        author: item.author,
        tags: item.tags || [],
        dependencies: item.dependencies || [],
        source: item.source,
      })) as Pack[];
    }

    return [];
  } catch (error) {
    console.error('Failed to fetch packs:', error);
    throw error;
  }
}

/**
 * Fetches a specific pack by ID
 */
export async function fetchPack(packId: string): Promise<Pack> {
  try {
    const response = await fetch(`${BASE_URL}/packs/${packId}`);
    const data = await handleResponse<any>(response);

    return {
      id: data.id,
      displayName: data.displayName || data.name,
      description: data.description,
      version: data.version,
      author: data.author,
      tags: data.tags || [],
      dependencies: data.dependencies || [],
      source: data.source,
    } as Pack;
  } catch (error) {
    console.error(`Failed to fetch pack ${packId}:`, error);
    throw error;
  }
}

/**
 * Fetches knowledge objects from a specific pack
 */
export async function fetchPackKnowledgeObjects(packId: string): Promise<KnowledgeObject[]> {
  try {
    // Attempt to fetch functions, pipelines, and other KOs from the pack
    const knowledgeObjects: KnowledgeObject[] = [];

    // Fetch functions
    try {
      const functionsResponse = await fetch(`${BASE_URL}/p/${packId}/functions`);
      if (functionsResponse.ok) {
        const data = await functionsResponse.json() as any;
        if (Array.isArray(data.items)) {
          knowledgeObjects.push(
            ...data.items.map((item: any) => ({
              id: item.id,
              name: item.id || item.name,
              type: 'function',
              description: item.description,
              pack: packId,
            }))
          );
        }
      }
    } catch (e) {
      console.warn(`Could not fetch functions for pack ${packId}:`, e);
    }

    // Fetch pipelines
    try {
      const pipelinesResponse = await fetch(`${BASE_URL}/p/${packId}/pipelines`);
      if (pipelinesResponse.ok) {
        const data = await pipelinesResponse.json() as any;
        if (Array.isArray(data.items)) {
          knowledgeObjects.push(
            ...data.items.map((item: any) => ({
              id: item.id,
              name: item.id || item.name,
              type: 'pipeline',
              description: item.description,
              pack: packId,
            }))
          );
        }
      }
    } catch (e) {
      console.warn(`Could not fetch pipelines for pack ${packId}:`, e);
    }

    // Fetch routes
    try {
      const routesResponse = await fetch(`${BASE_URL}/p/${packId}/routes`);
      if (routesResponse.ok) {
        const data = await routesResponse.json() as any;
        if (Array.isArray(data.items)) {
          knowledgeObjects.push(
            ...data.items.map((item: any) => ({
              id: item.id,
              name: item.id || item.name,
              type: 'route',
              description: item.description,
              pack: packId,
            }))
          );
        }
      }
    } catch (e) {
      console.warn(`Could not fetch routes for pack ${packId}:`, e);
    }

    return knowledgeObjects;
  } catch (error) {
    console.error(`Failed to fetch knowledge objects for pack ${packId}:`, error);
    throw error;
  }
}

/**
 * Fetches packs inherited by a specific fleet/group
 */
export async function fetchFleetPacks(groupId: string, product: string = 'stream'): Promise<Pack[]> {
  try {
    const response = await fetch(`${BASE_URL}/products/${product}/groups/${groupId}`);
    const data = await handleResponse<any>(response);

    // Extract packs from group configuration
    const packs: Pack[] = [];
    if (data.packs && Array.isArray(data.packs)) {
      return data.packs.map((item: any) => ({
        id: item.id || item,
        displayName: item.displayName || item.name || item,
        description: item.description,
        version: item.version,
      })) as Pack[];
    }

    return packs;
  } catch (error) {
    console.error(`Failed to fetch packs for fleet ${groupId}:`, error);
    throw error;
  }
}

export { ApiError };
