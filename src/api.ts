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
  PackReference,
  PackRelationshipSummary,
  PackUsageLocation,
  PipelineContentPreview,
  RouteContentPreview,
} from './types';
import { readPackArchiveVersion, rewritePackArchive, type PackMetadataEdits } from './packArchive.ts';

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

/** Cribl failed to build the temporary package for a `merge` export. */
export class PackExportAssemblyError extends ApiError {
  constructor(message: string, status: number, details?: unknown) {
    super(message, status, details);
    this.name = 'PackExportAssemblyError';
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

function resolvePackInheritanceStatus(pack: Pick<Pack, 'groupIds' | 'inheritedFrom' | 'inheritedModified' | 'configDrift'>): Pack['status'] {
  if (pack.inheritedModified || pack.configDrift) {
    return 'inherited-modified';
  }

  if (pack.inheritedFrom || (pack.groupIds && pack.groupIds.length > 0)) {
    return 'inherited';
  }

  return 'local';
}

function normalizePackSource(source: unknown): Pack['source'] {
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) {
      return undefined;
    }

    return {
      type: trimmed.startsWith('git+') ? 'git' : trimmed.endsWith('.crbl') ? 'url' : 'url',
      location: trimmed,
    };
  }

  if (isRecord(source)) {
    const location = readString(source.location);
    if (!location) {
      return undefined;
    }

    return {
      type: readString(source.type) ?? 'unknown',
      location,
    };
  }

  return undefined;
}

function mapPack(item: ApiRecord, groupId?: string): Pack {
  const id = readString(item.id) ?? readString(item.name) ?? 'unknown-pack';
  const inheritedFrom = readString(item.__srcGroup) ?? groupId;
  const inheritedModified = item.__srcOverridden === true;
  const groupIds = groupId ? [groupId] : undefined;
  const pack: Pack = {
    id,
    displayName: readString(item.displayName) ?? readString(item.name),
    description: readString(item.description),
    version: readString(item.version),
    author: readString(item.author),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    dependencies: Array.isArray(item.dependencies)
      ? item.dependencies.filter((dependency): dependency is string => typeof dependency === 'string')
      : [],
    groupIds,
    inheritedFrom,
    inheritedModified,
    configDrift: false,
    status: undefined,
    source: normalizePackSource(item.source),
  };

  pack.status = resolvePackInheritanceStatus(pack);
  rememberPackGroup(id, groupId);

  return pack;
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

function mapRouteTableEntries(item: ApiRecord, packId: string): KnowledgeObject[] {
  if (!Array.isArray(item.routes)) {
    return [];
  }

  return item.routes
    .filter(isRecord)
    .map((route) => ({
      id: readString(route.id) ?? readString(route.name) ?? 'default',
      name: readString(route.name) ?? readString(route.id) ?? 'default',
      type: 'route' as const,
      description: readString(route.description),
      pack: packId,
    }));
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
      const normalized = {
        ...pack,
        groupIds: pack.groupIds ? [...pack.groupIds] : undefined,
        inheritedFrom: pack.inheritedFrom,
        inheritedModified: Boolean(pack.inheritedModified),
        configDrift: Boolean(pack.configDrift),
        status: resolvePackInheritanceStatus(pack),
      };
      byId.set(key, normalized);
      return;
    }

    const mergedGroupIds = new Set([...(existing.groupIds ?? []), ...(pack.groupIds ?? [])]);
    const mergedPack: Pack = {
      ...existing,
      ...pack,
      groupIds: mergedGroupIds.size > 0 ? Array.from(mergedGroupIds) : undefined,
      inheritedFrom: pack.inheritedFrom ?? existing.inheritedFrom,
      inheritedModified: Boolean(pack.inheritedModified || existing.inheritedModified),
      configDrift: Boolean(pack.configDrift || existing.configDrift),
    };
    mergedPack.status = resolvePackInheritanceStatus(mergedPack);

    byId.set(key, mergedPack);
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

function normalizeRouteEntries(items: ApiRecord[]): Array<Record<string, unknown>> {
  return items.flatMap((item) => {
    if (!Array.isArray(item.routes)) {
      return [];
    }

    return item.routes.filter(isRecord).map((route) => ({
      id: readString(route.id) ?? readString(route.name) ?? 'default',
      name: readString(route.name) ?? readString(route.id) ?? 'default',
      filter: readString(route.filter),
      pipeline: readString(route.pipeline),
      output: readString(route.output),
      description: readString(route.description),
      final: typeof route.final === 'boolean' ? route.final : undefined,
      disabled: typeof route.disabled === 'boolean' ? route.disabled : undefined,
    }));
  });
}

function routeSignature(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify(entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    filter: entry.filter,
    pipeline: entry.pipeline,
    output: entry.output,
    description: entry.description,
    final: entry.final,
    disabled: entry.disabled,
  })));
}

async function detectPackConfigDrift(groupId: string, packId: string, sourceGroupIds: string[] = []): Promise<boolean> {
  const uniqueSourceGroupIds = Array.from(
    new Set(sourceGroupIds.filter((candidate): candidate is string => Boolean(candidate && candidate !== groupId))),
  );

  if (uniqueSourceGroupIds.length === 0) {
    return false;
  }

  try {
    const routeComparisons = await Promise.all(
      uniqueSourceGroupIds.map(async (sourceGroupId) => {
        const [sourceRoutes, targetRoutes] = await Promise.all([
          fetchGroupScopedCollectionStrict(sourceGroupId, `/p/${encodePathSegment(packId)}/routes`),
          fetchGroupScopedCollectionStrict(groupId, `/p/${encodePathSegment(packId)}/routes`),
        ]);

        const sourceEntries = normalizeRouteEntries(sourceRoutes);
        const targetEntries = normalizeRouteEntries(targetRoutes);

        return routeSignature(sourceEntries) !== routeSignature(targetEntries);
      }),
    );

    return routeComparisons.some(Boolean);
  } catch {
    return false;
  }
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
      const mapped = await Promise.all(groupScopedPacks.map(async (item) => {
        const pack = mapPack(item, groupId);
        const sourceCandidates = Array.from(
          new Set([
            ...(pack.inheritedFrom ? [pack.inheritedFrom] : []),
            ...getPackGroupCandidates(pack.id),
            ...(pack.groupIds ?? []),
          ]),
        );

        if (sourceCandidates.length > 0) {
          pack.configDrift = await detectPackConfigDrift(groupId, pack.id, sourceCandidates);
          pack.status = resolvePackInheritanceStatus(pack);
        }

        return pack;
      }));

      packs.push(...mapped);
      continue;
    }

    try {
      const detail = await fetchRecord(`/products/${product}/groups/${encodePathSegment(groupId)}`);
      if (Array.isArray(detail.packs)) {
        detail.packs.forEach((packItem) => {
          if (typeof packItem === 'string') {
            rememberPackGroup(packItem, groupId);
            packs.push({
              id: packItem,
              displayName: packItem,
              groupIds: [groupId],
              inheritedFrom: groupId,
              configDrift: false,
              status: 'inherited',
            });
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

function dedupePackUsageLocations(usageLocations: PackUsageLocation[]): PackUsageLocation[] {
  const byKey = new Map<string, PackUsageLocation>();

  usageLocations.forEach((usageLocation) => {
    byKey.set(`${usageLocation.product}:${usageLocation.fleetId}`, usageLocation);
  });

  return Array.from(byKey.values()).sort((left, right) => {
    const productOrder = left.product.localeCompare(right.product);

    if (productOrder !== 0) {
      return productOrder;
    }

    return left.fleetName.localeCompare(right.fleetName);
  });
}

function dedupePackReferences(references: PackReference[]): PackReference[] {
  const byKey = new Map<string, PackReference>();

  references.forEach((reference) => {
    byKey.set(reference.packId.toLowerCase(), reference);
  });

  return Array.from(byKey.values()).sort((left, right) => left.packDisplayName.localeCompare(right.packDisplayName));
}

export async function fetchPackRelationshipSummaries(): Promise<PackRelationshipSummary[]> {
  const [packs, fleets] = await Promise.all([fetchPacks(), fetchAllFleets()]);
  const packUsageResults = await Promise.allSettled(
    fleets.map(async (fleet) => ({
      fleet,
      packs: await fetchFleetPacks(fleet.id, fleet.product),
    })),
  );

  const packNameLookup = new Map<string, string>();
  const summariesById = new Map<string, PackRelationshipSummary>();

  const ensureSummary = (pack: Pack): PackRelationshipSummary => {
    const key = pack.id.toLowerCase();
    const existing = summariesById.get(key);

    if (existing) {
      const merged: PackRelationshipSummary = {
        ...existing,
        ...pack,
        tags: Array.from(new Set([...(existing.tags ?? []), ...(pack.tags ?? [])])),
        dependencies: Array.from(new Set([...(existing.dependencies ?? []), ...(pack.dependencies ?? [])])),
        groupIds: Array.from(new Set([...(existing.groupIds ?? []), ...(pack.groupIds ?? [])])),
        usageLocations: existing.usageLocations,
        references: existing.references,
        referencedBy: existing.referencedBy,
      };
      summariesById.set(key, merged);
      if (merged.displayName) {
        packNameLookup.set(key, merged.displayName);
      }
      return merged;
    }

    const created: PackRelationshipSummary = {
      ...pack,
      tags: pack.tags ?? [],
      dependencies: pack.dependencies ?? [],
      groupIds: pack.groupIds ?? [],
      usageLocations: [],
      references: [],
      referencedBy: [],
    };
    summariesById.set(key, created);
    packNameLookup.set(key, created.displayName ?? created.id);
    return created;
  };

  packs.forEach((pack) => {
    ensureSummary(pack);
  });

  packUsageResults.forEach((result) => {
    if (result.status !== 'fulfilled') {
      return;
    }

    const { fleet, packs: fleetPacks } = result.value;

    fleetPacks.forEach((pack) => {
      const summary = ensureSummary(pack);
      summary.usageLocations.push({
        fleetId: fleet.id,
        fleetName: fleet.name,
        product: fleet.product,
        status: pack.status,
        inheritedFrom: pack.inheritedFrom,
        parentFleetId: fleet.parentId,
        configDrift: pack.configDrift,
        version: pack.version,
      });
    });
  });

  const summaries = Array.from(summariesById.values());

  summaries.forEach((summary) => {
    summary.usageLocations = dedupePackUsageLocations(summary.usageLocations);
  });

  summaries.forEach((summary) => {
    const references = (summary.dependencies ?? []).map((dependency) => {
      const key = dependency.toLowerCase();

      return {
        packId: dependency,
        packDisplayName: packNameLookup.get(key) ?? dependency,
        exists: packNameLookup.has(key),
      } satisfies PackReference;
    });

    summary.references = dedupePackReferences(references);
  });

  const referencedByBuckets = new Map<string, PackReference[]>();

  summaries.forEach((summary) => {
    summary.references.forEach((reference) => {
      const key = reference.packId.toLowerCase();
      const current = referencedByBuckets.get(key) ?? [];
      current.push({
        packId: summary.id,
        packDisplayName: summary.displayName ?? summary.id,
        exists: true,
      });
      referencedByBuckets.set(key, current);
    });
  });

  summaries.forEach((summary) => {
    summary.referencedBy = dedupePackReferences(referencedByBuckets.get(summary.id.toLowerCase()) ?? []);
  });

  return summaries.sort((left, right) => (left.displayName ?? left.id).localeCompare(right.displayName ?? right.id));
}

export async function fetchPack(packId: string): Promise<Pack> {
  const payload = await fetchRecord(`/packs/${encodePathSegment(packId)}`);

  return mapPack(getCollectionItems(payload)[0] ?? payload);
}

/** Read the pack as a specific group sees it (including packs it inherits from a parent fleet). */
export async function fetchGroupPack(packId: string, groupId: string): Promise<Pack> {
  const payload = await fetchRecord(`/m/${encodeURIComponent(groupId)}/packs/${encodePathSegment(packId)}`);

  return mapPack(getCollectionItems(payload)[0] ?? payload, groupId);
}

export async function exportPack(
  packId: string,
  mode: 'merge' | 'default_only' = 'merge',
  filename?: string,
  groupId?: string,
): Promise<Blob> {
  const filenameQuery = encodeURIComponent(filename ?? `${packId}.crbl`);
  const exportEndpoints = [
    groupId ? `${requireBaseUrl()}/m/${encodeURIComponent(groupId)}/packs/${encodePathSegment(packId)}/export` : undefined,
    `${requireBaseUrl()}/packs/${encodePathSegment(packId)}/export`,
  ].filter((endpoint): endpoint is string => Boolean(endpoint));

  let lastError: { status: number; details: string; url: string } | undefined;

  for (const endpoint of exportEndpoints) {
    const url = `${endpoint}?mode=${encodeURIComponent(mode)}&filename=${filenameQuery}`;
    const response = await fetch(url);

    if (response.ok) {
      return response.blob();
    }

    const raw = await response.text();
    const details = raw ? raw : `HTTP ${response.status}`;
    lastError = { status: response.status, details, url };

    if (response.status === 404) {
      continue;
    }

    const lowered = details.toLowerCase();
    // Cribl copies the pack into a ".tmp" folder to build the export; ENOENT there means this group has no
    // complete copy of the pack of its own (for example package.json or default/ is missing).
    if (lowered.includes('enoent') && (lowered.includes('package.json') || lowered.includes('.tmp'))) {
      throw new PackExportAssemblyError(
        `Failed to export pack ${packId} (${mode} mode): Cribl could not assemble the temporary package. Endpoint: ${url}. Original error: ${details}`,
        response.status,
        details,
      );
    }

    throw new ApiError(`Failed to export pack ${packId}: ${details} (endpoint: ${url})`, response.status, details);
  }

  if (lastError) {
    throw new ApiError(
      `Failed to export pack ${packId}: ${lastError.details} (endpoint: ${lastError.url})`,
      lastError.status,
      lastError.details,
    );
  }

  throw new ApiError(`Failed to export pack ${packId}: Not Found`, 404, 'Not Found');
}

export async function uploadPack(file: File | Blob, filename?: string, groupId?: string): Promise<string> {
  const payloadFile = file instanceof File ? file : new File([file], filename ?? 'pack.crbl', { type: 'application/octet-stream' });
  const packsEndpoint = groupId ? `${requireBaseUrl()}/m/${encodeURIComponent(groupId)}/packs` : `${requireBaseUrl()}/packs`;
  const response = await fetch(`${packsEndpoint}?filename=${encodeURIComponent(payloadFile.name)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: payloadFile,
  });

  const body = await handleResponse<unknown>(response);
  const source = isRecord(body) ? readString(body.source) : undefined;

  if (!source) {
    throw new ApiError(`Unexpected pack upload response for ${payloadFile.name}`, response.status, body);
  }

  return source;
}

export interface PublishPackEditsResult {
  pack: Pack;
  previousVersion: string;
  newVersion: string;
  exportMode: 'merge' | 'default_only';
  warnings: string[];
}

export interface ExportedPackArchive {
  archive: Uint8Array<ArrayBuffer>;
  exportMode: 'merge' | 'default_only';
  version?: string;
}

/**
 * Export the installed pack from a group so it can be edited. `default_only` export is used only when
 * explicitly allowed, because it drops local modifications made to the pack.
 */
export async function exportPackForEditing(
  packId: string,
  options: { groupId?: string; allowOriginalConfigExport?: boolean; onProgress?: (step: string) => void } = {},
): Promise<ExportedPackArchive> {
  const { groupId, allowOriginalConfigExport = false, onProgress } = options;
  const filename = `${packId}.crbl`;

  onProgress?.('Exporting the installed pack…');
  let exportMode: ExportedPackArchive['exportMode'] = 'merge';
  let exported: Blob;

  try {
    exported = await exportPack(packId, 'merge', filename, groupId);
  } catch (error) {
    if (!(error instanceof PackExportAssemblyError) || !allowOriginalConfigExport) {
      throw error;
    }

    onProgress?.('Exporting the original pack configuration…');
    exportMode = 'default_only';
    exported = await exportPack(packId, 'default_only', filename, groupId);
  }

  const archive = new Uint8Array(await exported.arrayBuffer());

  return { archive, exportMode, version: await readPackArchiveVersion(archive) };
}

/**
 * Rewrite an exported pack's package.json with the edits, upload it, and upgrade the pack to it.
 * `version` sets the exact new version; without it the exported version's patch number is bumped.
 */
export async function installEditedPack(
  packId: string,
  exported: ExportedPackArchive,
  edits: PackMetadataEdits,
  options: { groupId?: string; version?: string; onProgress?: (step: string) => void } = {},
): Promise<PublishPackEditsResult> {
  const { groupId, version, onProgress } = options;
  const filename = `${packId}.crbl`;

  onProgress?.('Applying your edits to package.json…');
  const rewritten = await rewritePackArchive(exported.archive, edits, { version });

  onProgress?.(`Uploading version ${rewritten.newVersion}…`);
  const source = await uploadPack(new Blob([rewritten.archive]), filename, groupId);

  onProgress?.(`Installing version ${rewritten.newVersion}…`);
  const pack = await updatePack(packId, source, { minor: true, allowCustomFunctions: true, groupId });

  const warnings = [...rewritten.warnings];
  if (exported.exportMode === 'default_only') {
    warnings.push('Local modifications to this pack were not included, because only the original pack configuration could be exported.');
  }

  return {
    pack,
    previousVersion: rewritten.previousVersion,
    newVersion: rewritten.newVersion,
    exportMode: exported.exportMode,
    warnings,
  };
}

/** Export, edit, upload, and upgrade the pack in one group. */
export async function publishPackEdits(
  packId: string,
  edits: PackMetadataEdits,
  options: { groupId?: string; version?: string; allowOriginalConfigExport?: boolean; onProgress?: (step: string) => void } = {},
): Promise<PublishPackEditsResult> {
  const exported = await exportPackForEditing(packId, options);

  return installEditedPack(packId, exported, edits, options);
}

export async function updatePack(
  packId: string,
  source: string,
  options: Partial<{ minor: boolean; allowCustomFunctions: boolean; spec: string; groupId: string }> = {},
): Promise<Pack> {
  const endpoints = [
    options.groupId ? `${requireBaseUrl()}/m/${encodeURIComponent(options.groupId)}/packs/${encodePathSegment(packId)}` : undefined,
    `${requireBaseUrl()}/packs/${encodePathSegment(packId)}`,
  ].filter((endpoint): endpoint is string => Boolean(endpoint));

  let lastError: { status: number; details: string } | undefined;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source,
          minor: options.minor ?? true,
          allowCustomFunctions: options.allowCustomFunctions ?? true,
          ...(options.spec ? { spec: options.spec } : {}),
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        const details = raw ? raw : `HTTP ${response.status}`;
        lastError = { status: response.status, details };

        if (response.status !== 404) {
          throw new ApiError(`Failed to update pack ${packId}: ${details}`, response.status, details);
        }

        continue;
      }

      const payload = await handleResponse<unknown>(response);
      const item = getCollectionItems(payload)[0] ?? (isRecord(payload) ? payload : undefined);

      if (!item) {
        throw new ApiError(`Unexpected pack upgrade response for ${packId}`, response.status, payload);
      }

      return mapPack(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/up to date|already up to date/i.test(message)) {
        return fetchPack(packId);
      }

      if (error instanceof ApiError && error.status === 404) {
        continue;
      }

      throw error;
    }
  }

  if (lastError) {
    throw new ApiError(`Failed to update pack ${packId}: ${lastError.details}`, lastError.status, lastError.details);
  }

  throw new ApiError(`Failed to update pack ${packId}: Not Found`, 404, 'Not Found');
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

async function fetchPackRoutesForBasePath(packId: string): Promise<KnowledgeObject[]> {
  const basePath = `/p/${encodePathSegment(packId)}`;
  const items = await fetchCollection(`${basePath}/routes`);

  return items.flatMap((item) => mapRouteTableEntries(item, packId));
}

async function fetchPackRoutesForGroup(groupId: string, packId: string): Promise<KnowledgeObject[]> {
  const items = await fetchGroupScopedCollectionStrict(groupId, `/p/${encodePathSegment(packId)}/routes`);

  return items.flatMap((item) => mapRouteTableEntries(item, packId));
}

async function fetchKnowledgeObjectsForBasePath(basePath: string, packId: string): Promise<KnowledgeObject[]> {
  const [functions, pipelines, lookups, routes] = await Promise.allSettled([
    fetchKnowledgeObjectCollection(packId, 'function', `${basePath}/functions?showHidden=true`),
    fetchKnowledgeObjectCollection(packId, 'pipeline', `${basePath}/pipelines`),
    fetchKnowledgeObjectCollection(packId, 'lookup', `${basePath}/system/lookups`),
    fetchPackRoutesForBasePath(packId),
  ]);

  const failures = [functions, pipelines, lookups, routes].filter((result) => result.status === 'rejected');
  if (failures.length === 4) {
    throw (failures[0] as PromiseRejectedResult).reason;
  }

  return sortKnowledgeObjects([functions, pipelines, lookups, routes].flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  ));
}

async function fetchKnowledgeObjectsForGroup(groupId: string, packId: string): Promise<KnowledgeObject[]> {
  const encodedPackId = encodePathSegment(packId);
  const [functions, pipelines, lookups, routes] = await Promise.allSettled([
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'function', `/p/${encodedPackId}/functions?showHidden=true`),
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'pipeline', `/p/${encodedPackId}/pipelines`),
    fetchGroupScopedKnowledgeObjectCollection(groupId, packId, 'lookup', `/p/${encodedPackId}/system/lookups`),
    fetchPackRoutesForGroup(groupId, packId),
  ]);

  const failures = [functions, pipelines, lookups, routes].filter((result) => result.status === 'rejected');
  if (failures.length === 4) {
    throw (failures[0] as PromiseRejectedResult).reason;
  }

  return sortKnowledgeObjects([functions, pipelines, lookups, routes].flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  ));
}

export async function fetchPackKnowledgeObjects(packId: string, groupId?: string): Promise<KnowledgeObject[]> {
  const resolvedPackId = await resolvePackId(packId);
  const basePath = `/p/${encodePathSegment(resolvedPackId)}`;
  const candidateGroupIds = Array.from(
    new Set(groupId ? [groupId, ...getPackGroupCandidates(resolvedPackId)] : getPackGroupCandidates(resolvedPackId)),
  );

  if (groupId) {
    for (const candidateGroupId of candidateGroupIds) {
      try {
        return await fetchKnowledgeObjectsForGroup(candidateGroupId, resolvedPackId);
      } catch {
        // Try the next available group context.
      }
    }
  }

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

function findRouteEntryFromPayload(payload: unknown, routeId: string): ApiRecord | undefined {
  const items = getCollectionItems(payload);

  for (const item of items) {
    if (!Array.isArray(item.routes)) {
      continue;
    }

    const match = item.routes
      .filter(isRecord)
      .find((entry) => {
        const candidateId = readString(entry.id) ?? readString(entry.name);
        return candidateId === routeId;
      });

    if (match) {
      return match;
    }
  }

  return undefined;
}

function mapRouteContentPreview(payload: unknown, routeId: string): RouteContentPreview {
  const route = findRouteEntryFromPayload(payload, routeId) ?? findRouteEntryFromPayload(payload, 'default');

  if (!route) {
    throw new ApiError('Unexpected route response shape.', 500, payload);
  }

  const raw = route as Record<string, unknown>;

  return {
    id: readString(raw.id) ?? routeId,
    name: readString(raw.name) ?? routeId,
    description: readString(raw.description),
    filter: readString(raw.filter),
    pipeline: readString(raw.pipeline),
    output: readString(raw.output),
    final: typeof raw.final === 'boolean' ? raw.final : undefined,
    disabled: typeof raw.disabled === 'boolean' ? raw.disabled : undefined,
    tableId: readString(raw.tableId) ?? readString(raw.routingTableId) ?? 'default',
    raw,
  };
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

async function fetchRouteContentPreview(packId: string, routeId: string): Promise<RouteContentPreview> {
  const payload = await fetchJson(`/p/${encodePathSegment(packId)}/routes`);
  return mapRouteContentPreview(payload, routeId);
}

async function fetchGroupScopedRouteContentPreview(
  groupId: string,
  packId: string,
  routeId: string,
): Promise<RouteContentPreview> {
  const payload = await fetchGroupScopedJson(groupId, `/p/${encodePathSegment(packId)}/routes`);
  return mapRouteContentPreview(payload, routeId);
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
    if (groupId) {
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
    }

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
    if (groupId) {
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
    }

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

  if (knowledgeObject.type === 'route') {
    if (groupId) {
      for (const candidateGroupId of candidateGroupIds) {
        try {
          return {
            kind: 'route',
            route: await fetchGroupScopedRouteContentPreview(candidateGroupId, resolvedPackId, knowledgeObject.id),
          };
        } catch {
          // Try next known group context.
        }
      }
    }

    try {
      return {
        kind: 'route',
        route: await fetchRouteContentPreview(resolvedPackId, knowledgeObject.id),
      };
    } catch (globalError) {
      for (const candidateGroupId of candidateGroupIds) {
        try {
          return {
            kind: 'route',
            route: await fetchGroupScopedRouteContentPreview(candidateGroupId, resolvedPackId, knowledgeObject.id),
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
      return [{ id: packItem, displayName: packItem, groupIds: [groupId], inheritedFrom: groupId, status: 'inherited' }];
    }

    if (isRecord(packItem)) {
      return [mapPack(packItem, groupId)];
    }

    return [];
  });
}

export interface PendingPackChanges {
  /** Uncommitted files belonging to this pack in the given groups. */
  packFiles: string[];
  /** Other uncommitted files in the same groups, which are left out of the commit. */
  otherFiles: string[];
  conflictedFiles: string[];
}

/** List uncommitted config files for a pack in the given groups, from the Leader's git working tree. */
export async function fetchPendingPackChanges(packId: string, groupIds: string[]): Promise<PendingPackChanges> {
  const payload = await fetchRecord('/version/status');
  const status = getCollectionItems(payload)[0] ?? payload;
  const paths = new Set<string>();

  if (Array.isArray(status.files)) {
    status.files.forEach((file) => {
      const path = isRecord(file) ? readString(file.path) : undefined;
      if (path) {
        paths.add(path);
      }
    });
  }

  for (const key of ['not_added', 'created', 'deleted', 'modified', 'staged']) {
    const list = status[key];
    if (Array.isArray(list)) {
      list.forEach((path) => typeof path === 'string' && paths.add(path));
    }
  }

  if (Array.isArray(status.renamed)) {
    status.renamed.forEach((rename) => {
      const to = isRecord(rename) ? readString(rename.to) : undefined;
      if (to) {
        paths.add(to);
      }
    });
  }

  const conflicted = Array.isArray(status.conflicted)
    ? status.conflicted.filter((path): path is string => typeof path === 'string')
    : [];
  const groupPrefixes = groupIds.map((groupId) => `groups/${groupId}/`);
  const packKey = packId.toLowerCase();
  const inGroups = (path: string) => groupPrefixes.some((prefix) => path.startsWith(prefix));
  const isPackFile = (path: string) => path.toLowerCase().split('/').includes(packKey);
  const scoped = [...paths].filter(inGroups).sort();

  return {
    packFiles: scoped.filter(isPackFile),
    otherFiles: scoped.filter((path) => !isPackFile(path)),
    conflictedFiles: conflicted.filter((path) => inGroups(path) && isPackFile(path)),
  };
}

/** Commit only the listed files and return the new commit hash. */
export async function commitConfigChanges(message: string, files: string[]): Promise<string> {
  const response = await fetch(`${requireBaseUrl()}/version/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, files }),
  });
  const payload = await handleResponse<unknown>(response);
  const item = getCollectionItems(payload)[0] ?? (isRecord(payload) ? payload : undefined);
  const commit = item ? readString(item.commit) : undefined;

  if (!commit) {
    throw new ApiError('Cribl did not return a commit hash for the commit.', response.status, payload);
  }

  return commit;
}

/** Deploy a commit to a fleet and return the config version Cribl reports for it afterwards. */
export async function deployGroup(groupId: string, version: string, product?: FleetProduct): Promise<string | undefined> {
  const endpoint = product
    ? `${requireBaseUrl()}/products/${encodeURIComponent(product)}/groups/${encodeURIComponent(groupId)}/deploy`
    : `${requireBaseUrl()}/master/groups/${encodeURIComponent(groupId)}/deploy`;
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
  const payload = await handleResponse<unknown>(response);
  const item = getCollectionItems(payload)[0] ?? (isRecord(payload) ? payload : undefined);

  return item ? readString(item.configVersion) : undefined;
}

export { ApiError };
