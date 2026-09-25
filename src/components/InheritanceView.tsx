import { useEffect, useMemo, useState } from 'react';
import { Text } from '@capra/core';
import { useFleetPacks, useFleets, useKnowledgeObjectPreview, usePackKnowledgeObjects } from '../hooks';
import type { Fleet, FleetProduct, KnowledgeObject } from '../types';
import { ErrorState } from './ErrorBoundary';
import { FleetProductBadge } from './FleetProductBadge';
import { KnowledgeObjectGroups } from './KnowledgeObjectGroups';
import { EmptyState, SkeletonLoader } from './LoadingState';

const KNOWLEDGE_OBJECT_TYPES = ['all', 'lookup', 'pipeline', 'route', 'function'] as const;
type KnowledgeObjectTypeFilter = (typeof KNOWLEDGE_OBJECT_TYPES)[number];
type KnowledgeObjectSortMode = 'name-asc' | 'name-desc';

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

interface FleetTreeNodeModel {
  fleet: Fleet;
  children: FleetTreeNodeModel[];
}

export function InheritanceView() {
  const { data: fleets, loading: fleetsLoading, error: fleetsError, retry: retryFleets } = useFleets();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFleets, setExpandedFleets] = useState<Set<string>>(new Set());
  const [knowledgeObjectTypeFilter, setKnowledgeObjectTypeFilter] = useState<KnowledgeObjectTypeFilter>('all');
  const [knowledgeObjectSortMode, setKnowledgeObjectSortMode] = useState<KnowledgeObjectSortMode>('name-asc');

  const fleetForest = useMemo(() => {
    if (!fleets) {
      return [];
    }

    return buildFleetForest(fleets);
  }, [fleets]);

  const filteredFleetForest = useMemo(() => {
    if (!fleetForest.length) {
      return [];
    }

    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return fleetForest;
    }

    return fleetForest
      .map((node) => filterFleetTree(node, query))
      .filter((node): node is FleetTreeNodeModel => node !== null);
  }, [fleetForest, searchTerm]);

  const toggleFleet = (fleetId: string) => {
    const newExpanded = new Set(expandedFleets);
    if (newExpanded.has(fleetId)) {
      newExpanded.delete(fleetId);
    } else {
      newExpanded.add(fleetId);
    }
    setExpandedFleets(newExpanded);
  };

  if (fleetsLoading) {
    return <SkeletonLoader count={5} />;
  }

  if (fleetsError) {
    return <ErrorState error={fleetsError} onRetry={retryFleets} />;
  }

  if (!fleets || fleets.length === 0) {
    return (
      <EmptyState
        title="No fleets found"
        description="No fleets are currently visible for this Cribl environment."
      />
    );
  }

  return (
    <section className="panel">
      <div className="section-header">
        <Text as="h2" variant="heading-md">
          Fleet inheritance
        </Text>
        <div className="section-copy">
          <Text variant="body-sm-normal" color="secondary">
            Expand a fleet to inspect its packs and the knowledge objects inside each pack.
          </Text>
        </div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
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

      <div style={{ marginBottom: '0.75rem' }}>
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

      <input
        className="search-input"
        type="search"
        placeholder="Search fleets"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
      />

      <div className="list-stack">
        {filteredFleetForest.map((node) => (
          <FleetTreeNode
            key={`${node.fleet.product}:${node.fleet.id}`}
            node={node}
            expandedFleets={expandedFleets}
            onToggleFleet={toggleFleet}
            knowledgeObjectTypeFilter={knowledgeObjectTypeFilter}
            knowledgeObjectSortMode={knowledgeObjectSortMode}
          />
        ))}
      </div>
    </section>
  );
}

function buildFleetForest(fleets: Fleet[]): FleetTreeNodeModel[] {
  const nodeByKey = new Map<string, FleetTreeNodeModel>();

  fleets.forEach((fleet) => {
    nodeByKey.set(`${fleet.product}:${fleet.id}`, { fleet, children: [] });
  });

  const roots: FleetTreeNodeModel[] = [];

  fleets.forEach((fleet) => {
    const node = nodeByKey.get(`${fleet.product}:${fleet.id}`);
    if (!node) {
      return;
    }

    const parentId = fleet.parentId;
    if (!parentId || parentId === fleet.id) {
      roots.push(node);
      return;
    }

    const parentNode = nodeByKey.get(`${fleet.product}:${parentId}`);
    if (!parentNode) {
      roots.push(node);
      return;
    }

    parentNode.children.push(node);
  });

  const sortNodes = (nodes: FleetTreeNodeModel[]) => {
    nodes.sort((left, right) => left.fleet.name.localeCompare(right.fleet.name));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

function filterFleetTree(node: FleetTreeNodeModel, query: string): FleetTreeNodeModel | null {
  const matchesSelf =
    node.fleet.name.toLowerCase().includes(query) ||
    (node.fleet.description ?? '').toLowerCase().includes(query);

  const filteredChildren = node.children
    .map((child) => filterFleetTree(child, query))
    .filter((child): child is FleetTreeNodeModel => child !== null);

  if (!matchesSelf && filteredChildren.length === 0) {
    return null;
  }

  return {
    fleet: node.fleet,
    children: filteredChildren,
  };
}

function FleetTreeNode({
  node,
  expandedFleets,
  onToggleFleet,
  knowledgeObjectTypeFilter,
  knowledgeObjectSortMode,
}: {
  node: FleetTreeNodeModel;
  expandedFleets: Set<string>;
  onToggleFleet: (fleetId: string) => void;
  knowledgeObjectTypeFilter: KnowledgeObjectTypeFilter;
  knowledgeObjectSortMode: KnowledgeObjectSortMode;
}) {
  const fleetKey = `${node.fleet.product}:${node.fleet.id}`;
  const isExpanded = expandedFleets.has(fleetKey);

  return (
    <div className="tree-node">
      <button
        type="button"
        className={`tree-toggle${isExpanded ? ' tree-toggle-open' : ''}`}
        onClick={() => onToggleFleet(fleetKey)}
      >
        <span className="tree-caret" aria-hidden="true">
          {isExpanded ? '▼' : '▶'}
        </span>
        <div className="tree-copy">
          <div className="list-card-header">
            <Text variant="body-md-semibold">{node.fleet.name}</Text>
            <FleetProductBadge product={node.fleet.product} />
          </div>
          {node.fleet.description ? (
            <div className="section-copy">
              <Text variant="body-sm-normal" color="secondary">
                {node.fleet.description}
              </Text>
            </div>
          ) : null}
        </div>
      </button>

      {isExpanded ? (
        <div className="tree-children">
          <FleetPacksHierarchy
            fleetId={node.fleet.id}
            product={node.fleet.product}
            knowledgeObjectTypeFilter={knowledgeObjectTypeFilter}
            knowledgeObjectSortMode={knowledgeObjectSortMode}
          />

          {node.children.length > 0 ? (
            <div className="tree-children">
              {node.children.map((child) => (
                <FleetTreeNode
                  key={`${child.fleet.product}:${child.fleet.id}`}
                  node={child}
                  expandedFleets={expandedFleets}
                  onToggleFleet={onToggleFleet}
                  knowledgeObjectTypeFilter={knowledgeObjectTypeFilter}
                  knowledgeObjectSortMode={knowledgeObjectSortMode}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FleetPacksHierarchy({
  fleetId,
  product,
  knowledgeObjectTypeFilter,
  knowledgeObjectSortMode,
}: {
  fleetId: string;
  product: FleetProduct;
  knowledgeObjectTypeFilter: KnowledgeObjectTypeFilter;
  knowledgeObjectSortMode: KnowledgeObjectSortMode;
}) {
  const { data: fleetPacks, loading, error, retry } = useFleetPacks(fleetId, product);
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());

  const togglePack = (packId: string) => {
    const newExpanded = new Set(expandedPacks);
    if (newExpanded.has(packId)) {
      newExpanded.delete(packId);
    } else {
      newExpanded.add(packId);
    }
    setExpandedPacks(newExpanded);
  };

  if (loading) {
    return <SkeletonLoader count={3} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={retry} />;
  }

  if (!fleetPacks || fleetPacks.length === 0) {
    return (
      <div className="tree-children">
        <Text variant="body-sm-normal" color="secondary">
          No packs inherited
        </Text>
      </div>
    );
  }

  return (
    <div className="tree-children">
      {fleetPacks.map((pack) => {
        const isExpanded = expandedPacks.has(pack.id);

        return (
          <div key={pack.id} className="tree-node">
            <button
              type="button"
              className={`tree-toggle tree-toggle-compact${isExpanded ? ' tree-toggle-open' : ''}`}
              onClick={() => togglePack(pack.id)}
            >
              <span className="tree-caret" aria-hidden="true">
                {isExpanded ? '▼' : '▶'}
              </span>
              <div className="tree-copy">
                <Text variant="body-sm-semibold">{pack.displayName || pack.id}</Text>
                {pack.version ? (
                  <div className="section-copy">
                    <Text variant="body-xs-normal" color="secondary">
                      v{pack.version}
                    </Text>
                  </div>
                ) : null}
              </div>
            </button>

            {isExpanded ? (
              <PackKnowledgeObjectsList
                packId={pack.id}
                fleetId={fleetId}
                knowledgeObjectTypeFilter={knowledgeObjectTypeFilter}
                knowledgeObjectSortMode={knowledgeObjectSortMode}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PackKnowledgeObjectsList({
  packId,
  fleetId,
  knowledgeObjectTypeFilter,
  knowledgeObjectSortMode,
}: {
  packId: string;
  fleetId: string;
  knowledgeObjectTypeFilter: KnowledgeObjectTypeFilter;
  knowledgeObjectSortMode: KnowledgeObjectSortMode;
}) {
  const { data: knowledgeObjects, loading, error, retry } = usePackKnowledgeObjects(packId, fleetId);
  const [selectedKnowledgeObject, setSelectedKnowledgeObject] = useState<KnowledgeObject | null>(null);
  const {
    data: preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview,
  } = useKnowledgeObjectPreview(packId, selectedKnowledgeObject, fleetId);

  const visibleKnowledgeObjects = useMemo(() => {
    if (!knowledgeObjects) {
      return [];
    }

    const filtered =
      knowledgeObjectTypeFilter === 'all'
        ? knowledgeObjects
        : knowledgeObjects.filter((knowledgeObject) => knowledgeObject.type === knowledgeObjectTypeFilter);

    return sortKnowledgeObjectsByName(filtered, knowledgeObjectSortMode);
  }, [knowledgeObjectSortMode, knowledgeObjectTypeFilter, knowledgeObjects]);

  useEffect(() => {
    setSelectedKnowledgeObject(null);
  }, [packId]);

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
    return <SkeletonLoader count={2} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={retry} />;
  }

  if (!knowledgeObjects || knowledgeObjects.length === 0) {
    return (
      <div className="tree-children tree-children-leaf">
        <Text variant="body-xs-normal" color="secondary">
          No knowledge objects
        </Text>
      </div>
    );
  }

  return (
    <div className="tree-children tree-children-leaf">
      <KnowledgeObjectGroups
        knowledgeObjects={visibleKnowledgeObjects}
        variant="tree"
        selectedKnowledgeObjectKey={selectedKnowledgeObject ? `${selectedKnowledgeObject.type}:${selectedKnowledgeObject.id}` : null}
        onSelectKnowledgeObject={setSelectedKnowledgeObject}
        renderPreview={(knowledgeObject) => (
          <>
            <div className="section-copy">
              <Text variant="body-sm-semibold">{knowledgeObject.name}</Text>
            </div>
            {previewLoading ? <SkeletonLoader count={2} /> : null}
            {!previewLoading && previewError ? <ErrorState error={previewError} onRetry={retryPreview} /> : null}
            {!previewLoading && !previewError && preview?.kind === 'lookup' ? (
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
            ) : null}
            {!previewLoading && !previewError && preview?.kind === 'pipeline' ? (
              <pre className="preview-code">{JSON.stringify(preview.pipeline.definition, null, 2)}</pre>
            ) : null}
          </>
        )}
      />
    </div>
  );
}
