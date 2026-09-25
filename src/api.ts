/**
 * Cribl API Integration Layer
 * Provides typed fetch wrappers for Fleet, Pack, and KnowledgeObject data.
 */

import type {
  FetchError,
  Fleet,
  FleetProduct,
  KnowledgeObject,
  KnowledgeObjectPreview,
  LookupContentPreview,
  Pack,
  PipelineContentPreview,
} from './types';

type ApiRecord = Record<string, unknown>;
const FLEET_PRODUCTS: FleetProduct[] = ['stream', 'edge'];
const packGroupCandidates = new Map<string, Set<string>>();

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

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    return '/api/v1';
  }

  return window.CRIBL_API_URL ?? '';
}

export function hasCriblApiUrl(): boolean {
  return getBaseUrl().length > 0;
}

function requireBaseUrl(): string {
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    throw new ApiError(
      'Cribl API is unavailable in standalone Vite mode. Open the app in Cribl live preview to load live data.',
      0,
    );
  }

  return baseUrl;
}

function getCollectionItems(payload: unknown): ApiRecord[] {
  const unwrap = (value: unknown): ApiRecord[] => {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }

    if (!isRecord(value)) {
      return [];
    }

    for (const key of ['items', 'entries', 'packs', 'installed', 'data']) {
      if (Array.isArray(value[key])) {
        return value[key].filter(isRecord);
      }

      if (isRecord(value[key])) {
        const nested = unwrap(value[key]);
        if (nested.length > 0) {
          return nested;
        }
      }
    }

    return [];
  };

  return unwrap(payload);
}

function humanizeFleetName(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Unnamed fleet';
  }

  const normalized = trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return 'Unnamed fleet';
  }

  const title = normalized
    .split(' ')
    .filter(Boolean)
    .map((segment) => {
      if (segment.toLowerCase() === 'fleet') {
        return 'fleet';
      }

      if (segment.toLowerCase() === 'default') {
        return 'Default';
      }

      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    })
    .join(' ');

  if (/^Default(?:\s+Fleet)?$/i.test(title)) {
    return 'Default fleet';
  }

  return title;
}

function readFleetName(item: ApiRecord): string {
  const candidates = [
    item.name,
    item.displayName,
    item.display_name,
    item.title,
    item.label,
    item.groupName,
    item.group_name,
    item.groupId,
    item.group_id,
    item.id,
    item._id,
    item.fleetName,
    item.fleet_name,
  ];

  for (const candidate of candidates) {
    const value = readString(candidate);
    if (value) {
      if (value.toLowerCase() === 'default_fleet' || value.toLowerCase() === 'default') {
        return 'Default fleet';
      }

      return humanizeFleetName(value);
    }
  }

  return 'Unnamed fleet';
}

function readFleetParentId(item: ApiRecord): string | undefined {
  const parent = isRecord(item.parent) ? item.parent : undefined;

  const candidates = [
    item.inherits,
    item.parentId,
    item.parent_id,
    item.parentGroupId,
    item.parent_group_id,
    item.inheritsFrom,
    item.inherits_from,
    parent?.id,
    parent?.groupId,
    parent?.group_id,
    parent?.name,
  ];

  for (const candidate of candidates) {
    const value = readString(candidate);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function mapFleet(item: ApiRecord, product: FleetProduct): Fleet {
  const id = readString(item.id) ?? readString(item._id) ?? 'unknown-fleet';

  return {
    id,
    name: readFleetName(item),
    product,
    parentId: readFleetParentId(item),
    description: readString(item.description),
    type: readString(item.type),
    deployedVersion: readString(item.deployedConfigVersion),
    lastDeployTime: readNumber(item.lastDeployTime),
    lastConfigTime: readNumber(item.lastUpdateTime),
  };
}

function rememberPackGroup(packId: string, groupId?: string): void {
  if (!groupId) {
    return;
  }

  const key = packId.toLowerCase();
  const existing = packGroupCandidates.get(key) ?? new Set<string>();
  existing.add(groupId);
  packGroupCandidates.set(key, existing);
}

function getPackGroupCandidates(packId: string): string[] {
  return Array.from(packGroupCandidates.get(packId.toLowerCase()) ?? []);
}

function mapPack(item: ApiRecord, groupId?: string): Pack {
  const id = readString(item.id) ?? readString(item.name) ?? 'unknown-pack';
  rememberPackGroup(id, groupId);

  return {
    id,
    displayName: readString(item.displayName) ?? readString(item.name),
    description: readString(item.description),
    version: readString(item.version),
    author: readString(item.author),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    dependencies: Array.isArray(item.dependencies)
      ? item.dependencies.filter((dependency): dependency is string => typeof dependency === 'string')
      : [],
    groupIds: groupId ? [groupId] : undefined,
    source: isRecord(item.source)
      ? {
          type: readString(item.source.type) ?? 'unknown',
          location: readString(item.source.location),
        }
      : undefined,
  };
}

function mapKnowledgeObject(item: ApiRecord, type: KnowledgeObject['type'], packId: string): KnowledgeObject {
  return {
    id: readString(item.id) ?? readString(item.name) ?? `${type}-${packId}`,
    name: readString(item.name) ?? readString(item.id) ?? `Unnamed ${type}`,
    type,
    description: readString(item.description),
    pack: packId,
  };
}

function sortKnowledgeObjects(items: KnowledgeObject[]): KnowledgeObject[] {
  const typeOrder = new Map<string, number>([
    ['lookup', 0],
    ['pipeline', 1],
    ['route', 2],
    ['function', 3],
  ]);

  return items.sort((left, right) => {
    const leftOrder = typeOrder.get(left.type) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = typeOrder.get(right.type) ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.name.localeCompare(right.name);
  });
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

async function fetchCollection(endpoint: string): Promise<ApiRecord[]> {
  const baseUrl = requireBaseUrl();
  const response = await fetch(`${baseUrl}${endpoint}`);
  const payload = await handleResponse<unknown>(response);

  return getCollectionItems(payload);
}

async function fetchJson(endpoint: string): Promise<unknown> {
  const baseUrl = requireBaseUrl();
  const response = await fetch(`${baseUrl}${endpoint}`);

  return handleResponse<unknown>(response);
}

async function fetchRecord(endpoint: string): Promise<ApiRecord> {
  const baseUrl = requireBaseUrl();
  const response = await fetch(`${baseUrl}${endpoint}`);
  const payload = await handleResponse<unknown>(response);

  if (!isRecord(payload)) {
    throw new ApiError(`Unexpected response shape for ${endpoint}`, response.status, payload);
  }

  return payload;
}

function sortFleets(fleets: Fleet[]): Fleet[] {
  return fleets.sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name);

    if (nameOrder !== 0) {
      return nameOrder;
    }

    return left.product.localeCompare(right.product);
  });
}

export async function fetchGroups(product: FleetProduct = 'stream'): Promise<Fleet[]> {
  const items = await fetchCollection(`/products/${product}/groups`);

  return items.map((item) => mapFleet(item, product));
}

export async function fetchAllFleets(): Promise<Fleet[]> {
  const results = await Promise.allSettled(FLEET_PRODUCTS.map((product) => fetchGroups(product)));
  const fleets: Fleet[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      fleets.push(...result.value);
      return;
    }

    console.warn(`Failed to fetch ${FLEET_PRODUCTS[index]} fleets`, result.reason);
  });

  return sortFleets(fleets);
}

export async function fetchGroup(groupId: string, product: FleetProduct = 'stream'): Promise<Fleet> {
  const item = await fetchRecord(`/products/${product}/groups/${encodePathSegment(groupId)}`);

  return mapFleet(item, product);
}

function dedupePacks(packs: Pack[]): Pack[] {
  const byId = new Map<string, Pack>();

  packs.forEach((pack) => {
    const key = pack.id.toLowerCase();
    const existing = byId.get(key);

    if (!existing) {
      byId.set(key, { ...pack, groupIds: pack.groupIds ? [...pack.groupIds] : undefined });
      return;
    }

    const mergedGroupIds = new Set([...(existing.groupIds ?? []), ...(pack.groupIds ?? [])]);
    byId.set(key, {
      ...existing,
      ...pack,
      groupIds: mergedGroupIds.size > 0 ? Array.from(mergedGroupIds) : undefined,
    });
  });

  return Array.from(byId.values());
}

async function fetchGroupScopedCollection(groupId: string, endpoint: string): Promise<ApiRecord[]> {
  const baseUrl = requireBaseUrl();
  const response = await fetch(`${baseUrl}/m/${encodeURIComponent(groupId)}${endpoint}`);

  if (!response.ok) {
    return [];
  }

  try {
    const payload = await handleResponse<unknown>(response);
    return getCollectionItems(payload);
  } catch {
    return [];
  }
}

async function fetchGroupScopedCollectionStrict(groupId: string, endpoint: string): Promise<ApiRecord[]> {
  const payload = await fetchGroupScopedJson(groupId, endpoint);

  return getCollectionItems(payload);
}

async function fetchGroupScopedJson(groupId: string, endpoint: string): Promise<unknown> {
  const baseUrl = requireBaseUrl();
  const response = await fetch(`${baseUrl}/m/${encodePathSegment(groupId)}${endpoint}`);

  return handleResponse<unknown>(response);
}

async function fetchFleetPackEntries(product: FleetProduct): Promise<Pack[]> {
  const groups = await fetchCollection(`/products/${product}/groups`);
  const packs: Pack[] = [];

  for (const group of groups) {
    const groupId = readString(group.id);
    if (!groupId) {
      continue;
    }

    const groupScopedPacks = await fetchGroupScopedCollection(groupId, '/packs');
    if (groupScopedPacks.length > 0) {
      packs.push(...groupScopedPacks.map((item) => mapPack(item, groupId)));
      continue;
    }

    try {
      const detail = await fetchRecord(`/products/${product}/groups/${encodePathSegment(groupId)}`);
      if (Array.isArray(detail.packs)) {
        detail.packs.forEach((packItem) => {
          if (typeof packItem === 'string') {
            rememberPackGroup(packItem, groupId);
            packs.push({ id: packItem, displayName: packItem, groupIds: [groupId] });
            return;
          }

          if (isRecord(packItem)) {
            packs.push(mapPack(packItem, groupId));
          }
        });
      }
    } catch {
      // Some deployments expose packs only in the group-scoped /m/{group}/packs endpoint.
    }
  }

  return packs;
}

export async function fetchPacks(): Promise<Pack[]> {
  const result = await Promise.allSettled([
    fetchCollection('/packs').then((items) => items.map((item) => mapPack(item))),
    fetchFleetPackEntries('stream'),
    fetchFleetPackEntries('edge'),
  ]);

  const packs: Pack[] = [];

  result.forEach((entry) => {
    if (entry.status === 'fulfilled') {
      packs.push(...entry.value);
    }
  });

  return dedupePacks(packs);
}

export async function fetchPack(packId: string): Promise<Pack> {
  const item = await fetchRecord(`/packs/${encodePathSegment(packId)}`);

  return mapPack(item);
}

async function resolvePackId(packId: string): Promise<string> {
  try {
    const pack = await fetchPack(packId);
    return pack.id;
  } catch {
    return packId;
  }
}

async function fetchKnowledgeObjectCollection(
  packId: string,
  type: KnowledgeObject['type'],
  endpoint: string,
): Promise<KnowledgeObject[]> {
  const items = await fetchCollection(endpoint);

  return items.map((item) => mapKnowledgeObject(item, type, packId));
}

async function fetchGroupScopedKnowledgeObjectCollection(
  groupId: string,
  packId: string,
  type: KnowledgeObject['type'],
  endpoint: string,
): Promise<KnowledgeObject[]> {
  const items = await fetchGroupScopedCollectionStrict(groupId, endpoint);

  return items.map((item) => mapKnowledgeObject(item, type, packId));
}

async function fetchKnowledgeObjectsForBasePath(basePath: string, packId: string): Promise<KnowledgeObject[]> {
  const [functions, pipelines, routes, lookups] = await Promise.allSettled([
    fetchKnowledgeObjectCollection(packId, 'function', `${basePath}/functions?showHidden=true`),
    fetchKnowledgeObjectCollection(packId, 'pipeline', `${basePath}/pipelines`),
    fetchKnowledgeObjectCollection(packId, 'route', `${basePath}/routes`),
    fetchKnowledgeObjectCollection(packId, 'lookup', `${basePath}/system/lookups`),
  ]);

  const failures = [functions, pipelines, routes, lookups].filter((result) => result.status === 'rejected');
  if (failures.length === 4) {
    throw (failures[0] as PromiseRejectedResult).reason;
  }

  return sortKnowledgeObjects([functions, pipelines, routes, lookups].flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  ));
}

async function fetchKnowledgeObjectsForGroup(groupId: string, packId: string): Promise<KnowledgeObject[]> {
  const encodedPackId = encodePathSegment(packId);
  const [functions, pipelines, routes, lookups] = await Promise.allSettled([
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'function', `/p/${encodedPackId}/functions?showHidden=true`),
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'pipeline', `/p/${encodedPackId}/pipelines`),
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'route', `/p/${encodedPackId}/routes`),
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'lookup', `/p/${encodedPackId}/system/lookups`),
  ]);

  const failures = [functions, pipelines, routes, lookups].filter((result) => result.status === 'rejected');
  if (failures.length === 4) {
    throw (failures[0] as PromiseRejectedResult).reason;
  }

  return sortKnowledgeObjects([functions, pipelines, routes, lookups].flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  ));
}

export async function fetchPackKnowledgeObjects(packId: string, groupId?: string): Promise<KnowledgeObject[]> {
  const resolvedPackId = await resolvePackId(packId);
  const basePath = `/p/${encodePathSegment(resolvedPackId)}`;
  const candidateGroupIds = Array.from(
    new Set(groupId ? [groupId, ...getPackGroupCandidates(resolvedPackId)] : getPackGroupCandidates(resolvedPackId)),
  );

  try {
    return await fetchKnowledgeObjectsForBasePath(basePath, resolvedPackId);
  } catch (globalError) {
    for (const candidateGroupId of candidateGroupIds) {
      try {
        return await fetchKnowledgeObjectsForGroup(candidateGroupId, resolvedPackId);
      } catch {
        // Try the next available group context.
      }
    }

    throw globalError;
  }
}

function mapLookupContentPreview(payload: unknown): LookupContentPreview {
  if (!isRecord(payload) || !Array.isArray(payload.fields) || !Array.isArray(payload.items)) {
    throw new ApiError('Unexpected lookup content response shape.', 500, payload);
  }

  const fields = payload.fields.filter((field): field is string => typeof field === 'string');
  const rows = payload.items
    .filter(Array.isArray)
    .map((row) => row.filter((cell): cell is string | number => typeof cell === 'string' || typeof cell === 'number'));

  return {
    fields,
    rows,
    totalCount: readNumber(payload.totalCount) ?? rows.length,
  };
}

function mapPipelineContentPreview(payload: unknown): PipelineContentPreview {
  const items = getCollectionItems(payload);
  const definition = items[0];

  if (!definition) {
    throw new ApiError('Unexpected pipeline response shape.', 500, payload);
  }

  return { definition };
}

async function fetchLookupContentPreview(packId: string, lookupId: string): Promise<LookupContentPreview> {
  const payload = await fetchJson(
    `/p/${encodePathSegment(packId)}/system/lookups/${encodePathSegment(lookupId)}/content?limit=20`,
  );

  return mapLookupContentPreview(payload);
}

async function fetchGroupScopedLookupContentPreview(
  groupId: string,
  packId: string,
  lookupId: string,
): Promise<LookupContentPreview> {
  const payload = await fetchGroupScopedJson(
    groupId,
    `/p/${encodePathSegment(packId)}/system/lookups/${encodePathSegment(lookupId)}/content?limit=20`,
  );

  return mapLookupContentPreview(payload);
}

async function fetchPipelineContentPreview(packId: string, pipelineId: string): Promise<PipelineContentPreview> {
  const payload = await fetchJson(`/p/${encodePathSegment(packId)}/pipelines/${encodePathSegment(pipelineId)}`);

  return mapPipelineContentPreview(payload);
}

async function fetchGroupScopedPipelineContentPreview(
  groupId: string,
  packId: string,
  pipelineId: string,
): Promise<PipelineContentPreview> {
  const payload = await fetchGroupScopedJson(
    groupId,
    `/p/${encodePathSegment(packId)}/pipelines/${encodePathSegment(pipelineId)}`,
  );

  return mapPipelineContentPreview(payload);
}

export async function fetchKnowledgeObjectPreview(
  packId: string,
  knowledgeObject: KnowledgeObject,
  groupId?: string,
): Promise<KnowledgeObjectPreview | null> {
  const resolvedPackId = await resolvePackId(packId);
  const candidateGroupIds = Array.from(
    new Set(groupId ? [groupId, ...getPackGroupCandidates(resolvedPackId)] : getPackGroupCandidates(resolvedPackId)),
  );

  if (knowledgeObject.type === 'lookup') {
    try {
      return {
        kind: 'lookup',
        lookup: await fetchLookupContentPreview(resolvedPackId, knowledgeObject.id),
      };
    } catch (globalError) {
      for (const candidateGroupId of candidateGroupIds) {
        try {
          return {
            kind: 'lookup',
            lookup: await fetchGroupScopedLookupContentPreview(candidateGroupId, resolvedPackId, knowledgeObject.id),
          };
        } catch {
          // Try next known group context.
        }
      }

      throw globalError;
    }
  }

  if (knowledgeObject.type === 'pipeline') {
    try {
      return {
        kind: 'pipeline',
        pipeline: await fetchPipelineContentPreview(resolvedPackId, knowledgeObject.id),
      };
    } catch (globalError) {
      for (const candidateGroupId of candidateGroupIds) {
        try {
          return {
            kind: 'pipeline',
            pipeline: await fetchGroupScopedPipelineContentPreview(candidateGroupId, resolvedPackId, knowledgeObject.id),
          };
        } catch {
          // Try next known group context.
        }
      }

      throw globalError;
    }
  }

  return null;
}

export async function fetchFleetPacks(groupId: string, product: FleetProduct = 'stream'): Promise<Pack[]> {
  const groupScopedPacks = await fetchGroupScopedCollection(groupId, '/packs');

  if (groupScopedPacks.length > 0) {
    return dedupePacks(groupScopedPacks.map((item) => mapPack(item, groupId)));
  }

  const item = await fetchRecord(`/products/${product}/groups/${encodePathSegment(groupId)}`);

  if (!Array.isArray(item.packs)) {
    return [];
  }

  return item.packs.flatMap((packItem) => {
    if (typeof packItem === 'string') {
      rememberPackGroup(packItem, groupId);
      return [{ id: packItem, displayName: packItem, groupIds: [groupId] }];
    }

    if (isRecord(packItem)) {
      return [mapPack(packItem, groupId)];
    }

    return [];
  });
}

export { ApiError };
