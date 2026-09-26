import { useEffect, useMemo, useState } from 'react';
import { Text } from '@capra/core';
import type { FleetProduct, KnowledgeObject, PackReference, PackRelationshipSummary, PackUsageLocation } from '../types';
import { FleetProductBadge } from './FleetProductBadge';
import {
  useKnowledgeObjectPreview,
  usePackKnowledgeObjectInventories,
  usePackKnowledgeObjects,
  usePackRelationshipSummaries,
} from '../hooks';
import { ErrorState } from './ErrorBoundary';
import { KnowledgeObjectGroups } from './KnowledgeObjectGroups';
import { EmptyState, SkeletonLoader } from './LoadingState';

const KNOWLEDGE_OBJECT_TYPES = ['all', 'lookup', 'pipeline', 'route'] as const;
const PACK_VIEW_MODES = ['catalog', 'sankey'] as const;
const PACK_SANKEY_COLUMN_WIDTH = 220;
const PACK_SANKEY_COLUMN_GAP = 84;
const PACK_SANKEY_NODE_HEIGHT = 72;
const PACK_SANKEY_NODE_GAP = 18;
const PACK_SANKEY_PADDING = 24;
type KnowledgeObjectTypeFilter = (typeof KNOWLEDGE_OBJECT_TYPES)[number];
type PackViewMode = (typeof PACK_VIEW_MODES)[number];
type FleetProductFilter = 'all' | FleetProduct;

type KnowledgeObjectSortMode = 'name-asc' | 'name-desc';

interface PackSankeyNode {
  key: string;
  column: 'fleets' | 'packs' | 'references';
  label: string;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  packId?: string;
}

interface PackSankeyLink {
  key: string;
  path: string;
  title: string;
  kind: 'usage' | 'reference';
}

interface PackSankeyLayout {
  nodes: PackSankeyNode[];
  links: PackSankeyLink[];
  width: number;
  height: number;
}

interface PackDeploymentGroup {
  key: string;
  versionLabel: string;
  statusLabel: string;
  inheritedFromLabel: string;
  configDriftLabel: string;
  inventoryLabel: string;
  inventorySignature: string;
  usageLocations: PackUsageLocation[];
}

function sortKnowledgeObjectsByName(
  knowledgeObjects: KnowledgeObject[],
  sortMode: KnowledgeObjectSortMode,
): KnowledgeObject[] {
  const next = [...knowledgeObjects];

  next.sort((left, right) => left.name.localeCompare(right.name));

  if (sortMode === 'name-desc') {
    next.reverse();
  }

  return next;
}

export function PacksView() {
  const { data: packs, loading, error, retry } = usePackRelationshipSummaries();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<PackViewMode>('catalog');
  const [productFilter, setProductFilter] = useState<FleetProductFilter>('all');
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [selectedUsageContextKey, setSelectedUsageContextKey] = useState<string | null>(null);

  const filteredPacks = useMemo(() => {
    if (!packs) {
      return [];
    }

    const query = searchTerm.trim().toLowerCase();

    return packs.filter((pack) => {
      const matchesProduct =
        productFilter === 'all' || pack.usageLocations.some((usageLocation) => usageLocation.product === productFilter);

      if (!matchesProduct) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        (pack.displayName ?? '').toLowerCase().includes(query) ||
        (pack.description ?? '').toLowerCase().includes(query) ||
        pack.id.toLowerCase().includes(query) ||
        (pack.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false) ||
        pack.usageLocations.some((usageLocation) => usageLocation.fleetName.toLowerCase().includes(query)) ||
        pack.references.some((reference) => reference.packDisplayName.toLowerCase().includes(query)) ||
        pack.referencedBy.some((reference) => reference.packDisplayName.toLowerCase().includes(query))
      );
    });
  }, [packs, productFilter, searchTerm]);

  const selectedPack = filteredPacks.find((pack) => pack.id === selectedPackId) ?? packs?.find((pack) => pack.id === selectedPackId) ?? null;
  const visibleUsageLocations = useMemo(
    () => filterUsageLocationsByProduct(selectedPack?.usageLocations ?? [], productFilter),
    [productFilter, selectedPack?.usageLocations],
  );
  const selectedUsageLocation = useMemo(
    () =>
      visibleUsageLocations.find(
        (usageLocation) => `${usageLocation.product}:${usageLocation.fleetId}` === selectedUsageContextKey,
      ) ?? visibleUsageLocations[0] ?? null,
    [selectedUsageContextKey, visibleUsageLocations],
  );
  const selectedGroupId = selectedUsageLocation?.fleetId;
  const {
    data: knowledgeObjects,
    loading: koLoading,
    error: knowledgeError,
    retry: retryKnowledge,
  } = usePackKnowledgeObjects(selectedPackId, selectedGroupId);
  const [selectedKnowledgeObject, setSelectedKnowledgeObject] = useState<KnowledgeObject | null>(null);
  const [knowledgeObjectTypeFilter, setKnowledgeObjectTypeFilter] = useState<KnowledgeObjectTypeFilter>('all');
  const [knowledgeObjectSortMode, setKnowledgeObjectSortMode] = useState<KnowledgeObjectSortMode>('name-asc');
  const {
    data: preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview,
  } = useKnowledgeObjectPreview(selectedPackId, selectedKnowledgeObject, selectedGroupId);

  const sankeyLayout = useMemo(
    () => buildPackSankeyLayout(filteredPacks, productFilter),
    [filteredPacks, productFilter],
  );

  const summaryFleetCount = useMemo(() => {
    const fleetKeys = new Set<string>();
    filteredPacks.forEach((pack) => {
      filterUsageLocationsByProduct(pack.usageLocations, productFilter).forEach((usageLocation) => {
        fleetKeys.add(`${usageLocation.product}:${usageLocation.fleetId}`);
      });
    });
    return fleetKeys.size;
  }, [filteredPacks, productFilter]);

  const summaryReferenceCount = useMemo(() => {
    const referenceKeys = new Set<string>();
    filteredPacks.forEach((pack) => {
      pack.references.forEach((reference) => referenceKeys.add(reference.packId.toLowerCase()));
    });
    return referenceKeys.size;
  }, [filteredPacks]);

  const {
    data: packKnowledgeInventories,
    loading: inventoriesLoading,
    error: inventoriesError,
    retry: retryInventories,
  } = usePackKnowledgeObjectInventories(selectedPackId, visibleUsageLocations);

  const visibleDeploymentGroups = useMemo(
    () => buildPackDeploymentGroups(visibleUsageLocations, packKnowledgeInventories),
    [packKnowledgeInventories, visibleUsageLocations],
  );

  const visibleKnowledgeObjects = useMemo(() => {
    if (!knowledgeObjects) {
      return [];
    }

    const filtered = knowledgeObjectTypeFilter === 'all'
      ? knowledgeObjects
      : knowledgeObjects.filter((knowledgeObject) => knowledgeObject.type === knowledgeObjectTypeFilter);

    return sortKnowledgeObjectsByName(filtered, knowledgeObjectSortMode);
  }, [knowledgeObjectSortMode, knowledgeObjectTypeFilter, knowledgeObjects]);

  useEffect(() => {
    setSelectedKnowledgeObject(null);
  }, [selectedGroupId, selectedPackId]);

  useEffect(() => {
    if (filteredPacks.length === 0) {
      setSelectedPackId(null);
      return;
    }

    if (!selectedPackId || !filteredPacks.some((pack) => pack.id === selectedPackId)) {
      setSelectedPackId(filteredPacks[0]?.id ?? null);
    }
  }, [filteredPacks, selectedPackId]);

  useEffect(() => {
    if (!selectedPack) {
      setSelectedUsageContextKey(null);
      return;
    }

    if (visibleUsageLocations.length === 0) {
      setSelectedUsageContextKey(null);
      return;
    }

    const currentKey = selectedUsageContextKey;
    const hasCurrent = currentKey
      ? visibleUsageLocations.some((usageLocation) => `${usageLocation.product}:${usageLocation.fleetId}` === currentKey)
      : false;

    if (!hasCurrent) {
      const defaultUsageLocation = visibleUsageLocations[0];
      setSelectedUsageContextKey(`${defaultUsageLocation.product}:${defaultUsageLocation.fleetId}`);
    }
  }, [selectedPack, selectedUsageContextKey, visibleUsageLocations]);

  useEffect(() => {
    if (
      selectedKnowledgeObject &&
      !visibleKnowledgeObjects.some(
        (knowledgeObject) =>
          knowledgeObject.type === selectedKnowledgeObject.type &&
          knowledgeObject.id === selectedKnowledgeObject.id,
      )
    ) {
      setSelectedKnowledgeObject(null);
    }
  }, [selectedKnowledgeObject, visibleKnowledgeObjects]);

  if (loading) {
    return <SkeletonLoader count={5} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={retry} />;
  }

  if (!packs || packs.length === 0) {
    return (
      <EmptyState
        title="No packs found"
        description="No packs are currently visible for this Cribl environment."
      />
    );
  }

  return (
    <section className="split-layout">
      <div className="panel">
        <div className="section-header">
          <Text as="h2" variant="heading-md">
            Packs
          </Text>
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Browse pack metadata and inspect the objects each pack contains.
            </Text>
          </div>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <Text variant="body-xs-semibold" color="secondary">
            View mode
          </Text>
          <div className="pill-row" style={{ marginTop: '0.35rem' }}>
            {PACK_VIEW_MODES.map((mode) => {
              const isSelected = viewMode === mode;
              const label = mode === 'catalog' ? 'Catalog' : 'Sankey chart';

              return (
                <button
                  key={mode}
                  type="button"
                  className={`pill${isSelected ? '' : ' pill-subtle'}`}
                  onClick={() => setViewMode(mode)}
                  aria-pressed={isSelected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <Text variant="body-xs-semibold" color="secondary">
            Fleet product
          </Text>
          <div className="pill-row" style={{ marginTop: '0.35rem' }}>
            {(['all', 'stream', 'edge'] as const).map((option) => {
              const isSelected = productFilter === option;
              const label = option === 'all' ? 'All fleets' : option === 'stream' ? 'Stream' : 'Edge';

              return (
                <button
                  key={option}
                  type="button"
                  className={`pill${isSelected ? '' : ' pill-subtle'}`}
                  onClick={() => setProductFilter(option)}
                  aria-pressed={isSelected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <input
          className="search-input"
          type="search"
          placeholder="Search packs"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <div className="inheritance-summary-grid">
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Packs in view
            </Text>
            <Text as="div" variant="heading-md">
              {filteredPacks.length}
            </Text>
          </div>
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Fleets using packs
            </Text>
            <Text as="div" variant="heading-md">
              {summaryFleetCount}
            </Text>
          </div>
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Referenced packs
            </Text>
            <Text as="div" variant="heading-md">
              {summaryReferenceCount}
            </Text>
          </div>
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Active chart
            </Text>
            <Text as="div" variant="heading-sm">
              {viewMode === 'catalog' ? 'Catalog' : 'Sankey chart'}
            </Text>
          </div>
        </div>

        {filteredPacks.length === 0 ? (
          <EmptyState
            title="No packs match this filter"
            description="Try a different pack name, fleet product, or reference search."
          />
        ) : viewMode === 'catalog' ? (
          <div className="list-stack list-stack-scroll">
            {filteredPacks.map((pack) => {
              const inheritanceLabel =
                pack.status === 'inherited-modified' ? 'Inherited modified' :
                pack.status === 'inherited' ? 'Inherited' : null;
              const usageCount = filterUsageLocationsByProduct(pack.usageLocations, productFilter).length;
              const deploymentGroups = buildPackDeploymentGroups(
                filterUsageLocationsByProduct(pack.usageLocations, productFilter),
                null,
              );
              const hasVersionMismatch = hasPackVersionMismatch(deploymentGroups);

              return (
                <button
                  key={pack.id}
                  type="button"
                  className={`list-card${selectedPack?.id === pack.id ? ' list-card-selected' : ''}`}
                  onClick={() => setSelectedPackId(pack.id)}
                >
                  <div className="list-card-header">
                    <Text variant="body-md-semibold">{pack.displayName || pack.id}</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {inheritanceLabel ? <span className="inheritance-pill">{inheritanceLabel}</span> : null}
                      {pack.version ? <span className="pill">v{pack.version}</span> : null}
                    </div>
                  </div>
                  {pack.description ? (
                    <div className="section-copy">
                      <Text variant="body-sm-normal" color="secondary">
                        {pack.description}
                      </Text>
                    </div>
                  ) : null}
                  <div className="pill-row">
                    <span className="pill pill-subtle">Used by {usageCount} fleet{usageCount === 1 ? '' : 's'}</span>
                    <span className="pill pill-subtle">References {pack.references.length} pack{pack.references.length === 1 ? '' : 's'}</span>
                    {hasVersionMismatch ? <span className="pill pack-version-pill">Version metadata mismatch</span> : null}
                    {deploymentGroups.length > 1 ? (
                      <span className="pill pill-subtle">{deploymentGroups.length} content groups</span>
                    ) : null}
                  </div>
                  {pack.tags && pack.tags.length > 0 ? (
                    <div className="pill-row">
                      {pack.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="pill pill-subtle">
                          {tag}
                        </span>
                      ))}
                      {pack.tags.length > 4 ? (
                        <span className="pill pill-subtle">+{pack.tags.length - 4} more</span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <PackRelationshipSankeyChart
            layout={sankeyLayout}
            selectedPackId={selectedPack?.id ?? null}
            onSelectPack={setSelectedPackId}
          />
        )}
      </div>

      <div className="panel">
        {selectedPack ? (
          <>
            <div className="section-header">
              <Text as="h2" variant="heading-md">
                Pack details
              </Text>
              <div className="section-copy">
                <Text variant="body-sm-normal" color="secondary">
                  Metadata and knowledge objects for the selected pack deployment context.
                </Text>
              </div>
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Viewing deployment
              </Text>
              {selectedUsageLocation ? (
                <>
                  <div className="section-copy">
                    <Text variant="body-sm-normal" color="secondary">
                      You are viewing the pack as deployed in {selectedUsageLocation.fleetName}. Pack content can differ across fleets even when the version matches.
                    </Text>
                  </div>
                  <div className="pill-row" style={{ marginTop: '0.75rem' }}>
                    {visibleUsageLocations.map((usageLocation) => {
                      const usageKey = `${usageLocation.product}:${usageLocation.fleetId}`;
                      const isSelected = usageKey === selectedUsageContextKey;

                      return (
                        <button
                          key={usageKey}
                          type="button"
                          className={`pill${isSelected ? '' : ' pill-subtle'}`}
                          onClick={() => setSelectedUsageContextKey(usageKey)}
                          aria-pressed={isSelected}
                        >
                          {usageLocation.fleetName}
                        </button>
                      );
                    })}
                  </div>

                  <div className="metadata-grid" style={{ marginTop: '1rem' }}>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Fleet
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.fleetName}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Product
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.product}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Group context
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.fleetId}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Resolved status
                      </Text>
                      <Text variant="body-md-normal">
                        {selectedUsageLocation.status === 'inherited-modified'
                          ? 'Inherited modified'
                          : selectedUsageLocation.status === 'inherited'
                            ? 'Inherited'
                            : selectedUsageLocation.status === 'local'
                              ? 'Local'
                              : 'Unknown'}
                      </Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Inherited from
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.inheritedFrom ?? '—'}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Config drift
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.configDrift ? 'Yes' : 'No'}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Deployment version
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.version ?? selectedPack.version ?? '—'}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Content summary
                      </Text>
                      <Text variant="body-md-normal">
                        {formatInventoryLabel(
                          packKnowledgeInventories?.get(`${selectedUsageLocation.product}:${selectedUsageLocation.fleetId}`),
                        )}
                      </Text>
                    </div>
                  </div>

                  <div className="pill-row" style={{ marginTop: '1rem' }}>
                    {hasPackVersionMismatch(visibleDeploymentGroups) ? (
                      <span className="pill pack-version-pill">Different version metadata deployed</span>
                    ) : (
                      <span className="pill pill-subtle">Same version metadata across visible fleets</span>
                    )}
                    <span className="pill pill-subtle">
                      {visibleDeploymentGroups.length} content-identical deployment group{visibleDeploymentGroups.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="section-copy">
                  <Text variant="body-sm-normal" color="secondary">
                    No fleet-scoped deployment is available for the current filter.
                  </Text>
                </div>
              )}
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Content-identical deployment groups
              </Text>
              <div className="section-copy">
                <Text variant="body-sm-normal" color="secondary">
                  These groups are based on actual fleet-scoped pack contents, not just the reported pack version.
                </Text>
              </div>
              {inventoriesLoading ? (
                <SkeletonLoader count={2} />
              ) : inventoriesError ? (
                <ErrorState error={inventoriesError} onRetry={retryInventories} />
              ) : visibleDeploymentGroups.length > 0 ? (
                <div className="list-stack" style={{ marginTop: '0.75rem' }}>
                  {visibleDeploymentGroups.map((group) => {
                    const isSelectedGroup = Boolean(
                      selectedUsageLocation && group.usageLocations.some(
                        (usageLocation) =>
                          usageLocation.fleetId === selectedUsageLocation.fleetId &&
                          usageLocation.product === selectedUsageLocation.product,
                      ),
                    );

                    return (
                      <div
                        key={group.key}
                        className={`detail-card pack-relationship-card${isSelectedGroup ? ' list-card-selected' : ''}`}
                      >
                        <div className="list-card-header">
                          <Text variant="body-sm-semibold">{group.versionLabel}</Text>
                          <span className={`pill${hasVersionLabel(group.versionLabel) ? ' pack-version-pill' : ' pill-subtle'}`}>
                            {group.usageLocations.length} fleet{group.usageLocations.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="pill-row" style={{ marginTop: '0.5rem' }}>
                          <span className="pill pill-subtle">{group.statusLabel}</span>
                          <span className="pill pill-subtle">Inherited from {group.inheritedFromLabel}</span>
                          <span className="pill pill-subtle">{group.configDriftLabel}</span>
                          <span className="pill pill-subtle">{group.inventoryLabel}</span>
                        </div>
                        <div className="section-copy">
                          <Text variant="body-xs-normal" color="secondary">
                            Fleets in this identical group: {group.usageLocations.map((usageLocation) => usageLocation.fleetName).join(', ')}
                          </Text>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="section-copy">
                  <Text variant="body-sm-normal" color="secondary">
                    No grouped deployment data is available for the current filter.
                  </Text>
                </div>
              )}
            </div>

            <div className="metadata-grid">
              <div className="metadata-row">
                <Text variant="body-xs-semibold" color="secondary">
                  ID
                </Text>
                <Text variant="body-md-normal">{selectedPack.id}</Text>
              </div>
              {selectedPack.status ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Aggregated inheritance
                  </Text>
                  <Text variant="body-md-normal">
                    {selectedPack.status === 'inherited-modified'
                      ? 'Inherited modified'
                      : selectedPack.status === 'inherited'
                        ? 'Inherited'
                        : 'Local'}
                  </Text>
                </div>
              ) : null}
              {selectedPack.version ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Catalog version
                  </Text>
                  <Text variant="body-md-normal">{selectedPack.version}</Text>
                </div>
              ) : null}
              {selectedPack.author ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Author
                  </Text>
                  <Text variant="body-md-normal">{selectedPack.author}</Text>
                </div>
              ) : null}
              {selectedPack.description ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Description
                  </Text>
                  <Text variant="body-md-normal">{selectedPack.description}</Text>
                </div>
              ) : null}
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Used by fleets
              </Text>
              {inventoriesLoading ? (
                <SkeletonLoader count={3} />
              ) : inventoriesError ? (
                <ErrorState error={inventoriesError} onRetry={retryInventories} />
              ) : visibleUsageLocations.length > 0 ? (
                <div className="list-stack" style={{ marginTop: '0.75rem' }}>
                  {visibleUsageLocations.map((usageLocation) => {
                    const inventory = packKnowledgeInventories?.get(`${usageLocation.product}:${usageLocation.fleetId}`) ?? [];
                    const inventoryLabel = formatInventoryLabel(inventory);
                    const differsFromSelected =
                      selectedUsageLocation
                        ? buildInventorySignature(inventory) !== buildInventorySignature(
                            packKnowledgeInventories?.get(`${selectedUsageLocation.product}:${selectedUsageLocation.fleetId}`) ?? [],
                          )
                        : false;

                    return (
                      <div key={`${usageLocation.product}:${usageLocation.fleetId}`} className="detail-card pack-relationship-card">
                        <div className="list-card-header">
                          <Text variant="body-sm-semibold">{usageLocation.fleetName}</Text>
                          <FleetProductBadge product={usageLocation.product} />
                        </div>
                        <div className="pill-row" style={{ marginTop: '0.5rem' }}>
                          <span className="pill pill-subtle">
                            {usageLocation.status === 'inherited-modified'
                              ? 'Inherited modified'
                              : usageLocation.status === 'inherited'
                                ? 'Inherited'
                                : usageLocation.status === 'local'
                                  ? 'Local'
                                  : 'Usage detected'}
                          </span>
                          <span className="pill pill-subtle">{inventoryLabel}</span>
                          {differsFromSelected ? <span className="pill pack-version-pill">Content differs</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="section-copy">
                  <Text variant="body-sm-normal" color="secondary">
                    No fleet usage matched the current product filter.
                  </Text>
                </div>
              )}
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Referenced packs
              </Text>
              <PackReferenceList
                references={selectedPack.references}
                emptyText="This pack does not declare references to other packs."
              />
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Referenced by
              </Text>
              <PackReferenceList
                references={selectedPack.referencedBy}
                emptyText="No other visible pack references this pack."
              />
            </div>

            {selectedPack.tags && selectedPack.tags.length > 0 ? (
              <div className="detail-section">
                <Text as="h3" variant="heading-sm">
                  Tags
                </Text>
                <div className="pill-row">
                  {selectedPack.tags.map((tag) => (
                    <span key={tag} className="pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Knowledge objects
              </Text>

              <div style={{ margin: '0.75rem 0 0.5rem' }}>
                <Text variant="body-xs-semibold" color="secondary">
                  Filter by type
                </Text>
                <div className="pill-row" style={{ marginTop: '0.35rem' }}>
                  {KNOWLEDGE_OBJECT_TYPES.map((option) => {
                    const isSelected = knowledgeObjectTypeFilter === option;
                    const label = option === 'all' ? 'All' : option.charAt(0).toUpperCase() + option.slice(1) + 's';

                    return (
                      <button
                        key={option}
                        type="button"
                        className={`pill${isSelected ? '' : ' pill-subtle'}`}
                        onClick={() => setKnowledgeObjectTypeFilter(option)}
                        aria-pressed={isSelected}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <Text variant="body-xs-semibold" color="secondary">
                  Sort by name
                </Text>
                <div className="pill-row" style={{ marginTop: '0.35rem' }}>
                  <button
                    type="button"
                    className={`pill${knowledgeObjectSortMode === 'name-asc' ? '' : ' pill-subtle'}`}
                    onClick={() => setKnowledgeObjectSortMode('name-asc')}
                  >
                    A–Z
                  </button>
                  <button
                    type="button"
                    className={`pill${knowledgeObjectSortMode === 'name-desc' ? '' : ' pill-subtle'}`}
                    onClick={() => setKnowledgeObjectSortMode('name-desc')}
                  >
                    Z–A
                  </button>
                </div>
              </div>

              {koLoading ? (
                <SkeletonLoader count={3} />
              ) : knowledgeError ? (
                <ErrorState error={knowledgeError} onRetry={retryKnowledge} />
              ) : visibleKnowledgeObjects.length > 0 ? (
                <>
                  <KnowledgeObjectGroups
                    knowledgeObjects={visibleKnowledgeObjects}
                    selectedKnowledgeObjectKey={selectedKnowledgeObject ? `${selectedKnowledgeObject.type}:${selectedKnowledgeObject.id}` : null}
                    onSelectKnowledgeObject={(knowledgeObject) => setSelectedKnowledgeObject((current) => {
                      if (
                        current &&
                        current.type === knowledgeObject.type &&
                        current.id === knowledgeObject.id
                      ) {
                        return null;
                      }

                      return knowledgeObject;
                    })}
                    renderPreview={(knowledgeObject) => (
                      <KnowledgeObjectPreviewPanel
                        knowledgeObject={knowledgeObject}
                        preview={preview}
                        loading={previewLoading}
                        error={previewError}
                        onRetry={retryPreview}
                      />
                    )}
                  />
                </>
              ) : (
                <EmptyState
                  title="No knowledge objects found"
                  description="This pack did not return lookups, pipelines, routes, or functions."
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title="Select a pack"
            description="Choose a pack from the list to inspect its metadata and objects."
          />
        )}
      </div>
    </section>
  );
}

function filterUsageLocationsByProduct(
  usageLocations: PackUsageLocation[],
  productFilter: FleetProductFilter,
): PackUsageLocation[] {
  return productFilter === 'all'
    ? usageLocations
    : usageLocations.filter((usageLocation) => usageLocation.product === productFilter);
}

function formatPackStatusLabel(status: PackUsageLocation['status']): string {
  if (status === 'inherited-modified') {
    return 'Inherited modified';
  }

  if (status === 'inherited') {
    return 'Inherited';
  }

  if (status === 'local') {
    return 'Local';
  }

  return 'Unknown';
}

function buildPackDeploymentGroups(
  usageLocations: PackUsageLocation[],
  inventories: Map<string, KnowledgeObject[]> | null,
): PackDeploymentGroup[] {
  const groups = new Map<string, PackDeploymentGroup>();

  usageLocations.forEach((usageLocation) => {
    const inventory = inventories?.get(`${usageLocation.product}:${usageLocation.fleetId}`) ?? [];
    const inventorySignature = buildInventorySignature(inventory);
    const inventoryLabel = formatInventoryLabel(inventory);
    const key = inventorySignature || 'empty-inventory';
    const existing = groups.get(key);

    if (existing) {
      existing.usageLocations.push(usageLocation);
      return;
    }

    groups.set(key, {
      key,
      versionLabel: '',
      statusLabel: '',
      inheritedFromLabel: '',
      configDriftLabel: '',
      inventoryLabel,
      inventorySignature,
      usageLocations: [usageLocation],
    });
  });

  groups.forEach((group) => {
    group.versionLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => usageLocation.version ? `v${usageLocation.version}` : 'Version unavailable'),
      'Mixed version metadata',
    );
    group.statusLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => formatPackStatusLabel(usageLocation.status)),
      'Mixed status metadata',
    );
    group.inheritedFromLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => usageLocation.inheritedFrom ?? 'local source'),
      'Multiple inheritance sources',
    );
    group.configDriftLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => usageLocation.configDrift ? 'Config drift detected' : 'No config drift'),
      'Mixed config drift state',
    );
  });

  return Array.from(groups.values()).sort((left, right) => {
    const fleetCountOrder = right.usageLocations.length - left.usageLocations.length;

    if (fleetCountOrder !== 0) {
      return fleetCountOrder;
    }

    return left.inventoryLabel.localeCompare(right.inventoryLabel);
  });
}

function hasPackVersionMismatch(groups: PackDeploymentGroup[]): boolean {
  const versions = new Set(groups.map((group) => group.versionLabel));
  return versions.size > 1;
}

function hasVersionLabel(versionLabel: string): boolean {
  return versionLabel !== 'Version unavailable' && versionLabel !== 'Mixed version metadata';
}

function summarizeGroupValues(values: string[], mixedLabel: string): string {
  const uniqueValues = Array.from(new Set(values));

  if (uniqueValues.length === 0) {
    return 'Unknown';
  }

  if (uniqueValues.length === 1) {
    return uniqueValues[0];
  }

  return mixedLabel;
}

function buildInventorySignature(inventory: KnowledgeObject[]): string {
  const normalized = [...inventory]
    .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))
    .map((knowledgeObject) => `${knowledgeObject.type}:${knowledgeObject.id}`);

  return normalized.join('|');
}

function formatInventoryLabel(inventory: KnowledgeObject[] | undefined): string {
  if (!inventory || inventory.length === 0) {
    return 'No knowledge objects';
  }

  const counts = new Map<string, number>();

  inventory.forEach((knowledgeObject) => {
    counts.set(knowledgeObject.type, (counts.get(knowledgeObject.type) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`)
    .join(', ');
}

function buildPackSankeyLayout(
  packs: PackRelationshipSummary[],
  productFilter: FleetProductFilter,
): PackSankeyLayout {
  const fleetNodes = new Map<string, PackSankeyNode>();
  const packNodes = new Map<string, PackSankeyNode>();
  const referenceNodes = new Map<string, PackSankeyNode>();
  const links: PackSankeyLink[] = [];

  packs.forEach((pack) => {
    const packKey = `pack:${pack.id.toLowerCase()}`;
    packNodes.set(packKey, {
      key: packKey,
      column: 'packs',
      label: pack.displayName ?? pack.id,
      subtitle: `${filterUsageLocationsByProduct(pack.usageLocations, productFilter).length} fleet use${filterUsageLocationsByProduct(pack.usageLocations, productFilter).length === 1 ? '' : 's'}`,
      x: 0,
      y: 0,
      width: PACK_SANKEY_COLUMN_WIDTH,
      height: PACK_SANKEY_NODE_HEIGHT,
      packId: pack.id,
    });

    filterUsageLocationsByProduct(pack.usageLocations, productFilter).forEach((usageLocation) => {
      const fleetKey = `fleet:${usageLocation.product}:${usageLocation.fleetId}`;

      if (!fleetNodes.has(fleetKey)) {
        fleetNodes.set(fleetKey, {
          key: fleetKey,
          column: 'fleets',
          label: usageLocation.fleetName,
          subtitle: usageLocation.product === 'stream' ? 'Stream fleet' : 'Edge fleet',
          x: 0,
          y: 0,
          width: PACK_SANKEY_COLUMN_WIDTH,
          height: PACK_SANKEY_NODE_HEIGHT,
        });
      }

      links.push({
        key: `${fleetKey}->${packKey}`,
        path: '',
        title: `${usageLocation.fleetName} uses ${pack.displayName ?? pack.id}`,
        kind: 'usage',
      });
    });

    pack.references.forEach((reference) => {
      const referenceKey = `reference:${reference.packId.toLowerCase()}`;

      if (!referenceNodes.has(referenceKey)) {
        referenceNodes.set(referenceKey, {
          key: referenceKey,
          column: 'references',
          label: reference.packDisplayName,
          subtitle: reference.exists ? 'Referenced pack' : 'Unresolved reference',
          x: 0,
          y: 0,
          width: PACK_SANKEY_COLUMN_WIDTH,
          height: PACK_SANKEY_NODE_HEIGHT,
          packId: reference.exists ? reference.packId : undefined,
        });
      }

      links.push({
        key: `${packKey}->${referenceKey}`,
        path: '',
        title: `${pack.displayName ?? pack.id} references ${reference.packDisplayName}`,
        kind: 'reference',
      });
    });
  });

  const columns = [
    Array.from(fleetNodes.values()).sort((left, right) => left.label.localeCompare(right.label)),
    Array.from(packNodes.values()).sort((left, right) => left.label.localeCompare(right.label)),
    Array.from(referenceNodes.values()).sort((left, right) => left.label.localeCompare(right.label)),
  ];

  columns.forEach((column, columnIndex) => {
    column.forEach((node, rowIndex) => {
      node.x = PACK_SANKEY_PADDING + columnIndex * (PACK_SANKEY_COLUMN_WIDTH + PACK_SANKEY_COLUMN_GAP);
      node.y = PACK_SANKEY_PADDING + rowIndex * (PACK_SANKEY_NODE_HEIGHT + PACK_SANKEY_NODE_GAP);
    });
  });

  const nodeLookup = new Map(columns.flat().map((node) => [node.key, node]));

  links.forEach((link) => {
    const [sourceKey, targetKey] = link.key.split('->');
    const sourceNode = nodeLookup.get(sourceKey);
    const targetNode = nodeLookup.get(targetKey);

    if (!sourceNode || !targetNode) {
      return;
    }

    const sourceX = sourceNode.x + sourceNode.width;
    const sourceY = sourceNode.y + sourceNode.height / 2;
    const targetX = targetNode.x;
    const targetY = targetNode.y + targetNode.height / 2;
    const controlOffset = Math.max((targetX - sourceX) * 0.42, 32);
    link.path = `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;
  });

  const tallestColumn = columns.reduce((currentMax, column) => Math.max(currentMax, column.length), 1);

  return {
    nodes: columns.flat(),
    links: links.filter((link) => link.path.length > 0),
    width: PACK_SANKEY_PADDING * 2 + 3 * PACK_SANKEY_COLUMN_WIDTH + 2 * PACK_SANKEY_COLUMN_GAP,
    height:
      PACK_SANKEY_PADDING * 2 +
      tallestColumn * PACK_SANKEY_NODE_HEIGHT +
      Math.max(tallestColumn - 1, 0) * PACK_SANKEY_NODE_GAP,
  };
}

function PackRelationshipSankeyChart({
  layout,
  selectedPackId,
  onSelectPack,
}: {
  layout: PackSankeyLayout;
  selectedPackId: string | null;
  onSelectPack: (packId: string) => void;
}) {
  return (
    <div className="inheritance-sankey-shell">
      <div className="inheritance-sankey-caption">
        <Text variant="body-sm-normal" color="secondary">
          Flows show which fleets use each pack and which other packs that pack references.
        </Text>
      </div>

      <div className="inheritance-sankey-scroll">
        <svg
          className="inheritance-sankey-svg pack-sankey-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Pack relationship Sankey chart"
          preserveAspectRatio="xMinYMin meet"
        >
          {layout.links.map((link) => (
            <path
              key={link.key}
              d={link.path}
              className={`inheritance-sankey-link${link.kind === 'reference' ? ' pack-sankey-link-reference' : ''}`}
            >
              <title>{link.title}</title>
            </path>
          ))}

          {layout.nodes.map((node) => {
            const isSelected = node.packId === selectedPackId && node.column === 'packs';
            const interactive = Boolean(node.packId && node.column === 'packs');

            return (
              <g
                key={node.key}
                transform={`translate(${node.x}, ${node.y})`}
                className={interactive ? 'pack-sankey-node-interactive' : ''}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={interactive ? () => onSelectPack(node.packId!) : undefined}
                onKeyDown={interactive ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectPack(node.packId!);
                  }
                } : undefined}
              >
                <rect
                  className={`inheritance-sankey-node${isSelected ? ' pack-sankey-node-selected' : ''}`}
                  width={node.width}
                  height={node.height}
                  rx="14"
                  ry="14"
                />
                <rect
                  className={`inheritance-sankey-node-accent${node.column === 'references' ? ' pack-sankey-node-reference-accent' : ''}`}
                  width="8"
                  height={node.height}
                  rx="14"
                  ry="14"
                />
                <text x="18" y="26" className="inheritance-sankey-node-title">
                  {node.label}
                </text>
                <text x="18" y="48" className="inheritance-sankey-node-meta">
                  {node.subtitle}
                </text>
                <title>{node.label}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function PackReferenceList({ references, emptyText }: { references: PackReference[]; emptyText: string }) {
  if (references.length === 0) {
    return (
      <div className="section-copy">
        <Text variant="body-sm-normal" color="secondary">
          {emptyText}
        </Text>
      </div>
    );
  }

  return (
    <div className="pill-row" style={{ marginTop: '0.75rem' }}>
      {references.map((reference) => (
        <span key={reference.packId} className={`pill${reference.exists ? '' : ' pill-subtle'}`}>
          {reference.packDisplayName}
        </span>
      ))}
    </div>
  );
}

function KnowledgeObjectPreviewPanel({
  knowledgeObject,
  preview,
  loading,
  error,
  onRetry,
}: {
  knowledgeObject: KnowledgeObject;
  preview: Awaited<ReturnType<typeof useKnowledgeObjectPreview>>['data'];
  loading: boolean;
  error: Awaited<ReturnType<typeof useKnowledgeObjectPreview>>['error'];
  onRetry: () => void;
}) {
  return (
    <div className="detail-section">
      <Text as="h3" variant="heading-sm">
        Selected content
      </Text>

      {loading ? <SkeletonLoader count={2} /> : null}
      {!loading && error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && preview?.kind === 'lookup' ? (
        <div className="preview-card">
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Showing {preview.lookup.rows.length} of {preview.lookup.totalCount} rows for {knowledgeObject.name}.
            </Text>
          </div>
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  {preview.lookup.fields.map((field) => (
                    <th key={field}>{field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.lookup.rows.map((row, index) => (
                  <tr key={`${knowledgeObject.id}:${index}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${knowledgeObject.id}:${index}:${cellIndex}`}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {!loading && !error && preview?.kind === 'pipeline' ? (
        <div className="preview-card">
          <pre className="preview-code">{JSON.stringify(preview.pipeline.definition, null, 2)}</pre>
        </div>
      ) : null}
      {!loading && !error && preview?.kind === 'route' ? (
        <div className="preview-card">
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Route {preview.route.name} in table {preview.route.tableId}
            </Text>
          </div>
          <div className="preview-table-wrap">
            <table className="preview-table">
              <tbody>
                <tr><th>Id</th><td>{preview.route.id}</td></tr>
                <tr><th>Name</th><td>{preview.route.name}</td></tr>
                <tr><th>Pipeline</th><td>{preview.route.pipeline ?? '—'}</td></tr>
                <tr><th>Output</th><td>{preview.route.output ?? '—'}</td></tr>
                <tr><th>Filter</th><td>{preview.route.filter ?? '—'}</td></tr>
                <tr><th>Final</th><td>{String(preview.route.final ?? '—')}</td></tr>
                <tr><th>Disabled</th><td>{String(preview.route.disabled ?? '—')}</td></tr>
                <tr><th>Description</th><td>{preview.route.description ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {!loading && !error && preview === null ? (
        <div className="preview-card">
          <Text variant="body-sm-normal" color="secondary">
            Preview is available for lookups, pipelines, and routes.
          </Text>
        </div>
      ) : null}
    </div>
  );
}
