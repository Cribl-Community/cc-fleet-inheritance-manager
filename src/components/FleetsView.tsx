import { useEffect, useMemo, useState } from 'react';
import { Text } from '@capra/core';
import { useFleets } from '../hooks';
import type { Fleet, FleetProduct } from '../types';
import { ErrorState } from './ErrorBoundary';
import { FleetProductBadge, FleetProductInline } from './FleetProductBadge';
import { EmptyState, SkeletonLoader } from './LoadingState';

interface FleetTreeNodeModel {
  fleet: Fleet;
  children: FleetTreeNodeModel[];
}

function FleetMetadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="metadata-row">
      <Text variant="body-xs-semibold" color="secondary">
        {label}
      </Text>
      <Text variant="body-md-normal">{value}</Text>
    </div>
  );
}

export function FleetsView() {
  const { data: fleets, loading, error, retry } = useFleets();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFleet, setSelectedFleet] = useState<Fleet | null>(null);
  const [productFilter, setProductFilter] = useState<'all' | FleetProduct>('all');
  const [expandedFleets, setExpandedFleets] = useState<Set<string>>(new Set());

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

    return fleetForest
      .map((node) => filterFleetTree(node, query, productFilter))
      .filter((node): node is FleetTreeNodeModel => node !== null);
  }, [fleetForest, searchTerm, productFilter]);

  useEffect(() => {
    if (
      selectedFleet &&
      !fleets?.some(
        (fleet) =>
          fleet.id === selectedFleet.id &&
          fleet.product === selectedFleet.product &&
          (productFilter === 'all' || fleet.product === productFilter),
      )
    ) {
      setSelectedFleet(null);
    }
  }, [fleets, productFilter, selectedFleet]);

  const toggleFleet = (fleetKey: string) => {
    const nextExpanded = new Set(expandedFleets);

    if (nextExpanded.has(fleetKey)) {
      nextExpanded.delete(fleetKey);
    } else {
      nextExpanded.add(fleetKey);
    }

    setExpandedFleets(nextExpanded);
  };

  if (loading) {
    return <SkeletonLoader count={5} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={retry} />;
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
    <section className="split-layout">
      <div className="panel">
        <div className="section-header">
          <Text as="h2" variant="heading-md">
            Fleets
          </Text>
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Expand a fleet to inspect its parent/child hierarchy and the selected fleet details.
            </Text>
          </div>
        </div>

        <div className="pill-row" style={{ marginBottom: '0.75rem' }}>
          {(['all', 'stream', 'edge'] as const).map((option) => {
            const isSelected = productFilter === option;
            const label = option === 'all' ? 'All' : option === 'stream' ? 'Stream' : 'Edge';

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
              selectedFleet={selectedFleet}
              onSelectFleet={setSelectedFleet}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        {selectedFleet ? (
          <>
            <div className="section-header">
              <Text as="h2" variant="heading-md">
                Fleet details
              </Text>
              <FleetProductInline product={selectedFleet.product} />
              <div className="section-copy">
                <Text variant="body-sm-normal" color="secondary">
                  Review the selected fleet&apos;s metadata and deployment details.
                </Text>
              </div>
            </div>

            <div className="metadata-grid">
              <FleetMetadata label="ID" value={selectedFleet.id} />
              <FleetMetadata label="Product" value={selectedFleet.product} />
              <FleetMetadata label="Type" value={selectedFleet.type ?? 'Not reported'} />
              <FleetMetadata
                label="Description"
                value={selectedFleet.description ?? 'No description available'}
              />
              {selectedFleet.deployedVersion ? (
                <FleetMetadata label="Deployed version" value={selectedFleet.deployedVersion} />
              ) : null}
              {selectedFleet.lastDeployTime ? (
                <FleetMetadata
                  label="Last deploy"
                  value={new Date(selectedFleet.lastDeployTime).toLocaleString()}
                />
              ) : null}
              {selectedFleet.lastConfigTime ? (
                <FleetMetadata
                  label="Last config update"
                  value={new Date(selectedFleet.lastConfigTime).toLocaleString()}
                />
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            title="Select a fleet"
            description="Choose a fleet from the list to inspect its details."
          />
        )}
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

function filterFleetTree(
  node: FleetTreeNodeModel,
  query: string,
  productFilter: 'all' | FleetProduct,
): FleetTreeNodeModel | null {
  const productMatches = productFilter === 'all' || node.fleet.product === productFilter;

  const matchesSelf =
    productMatches &&
    (!query ||
      node.fleet.name.toLowerCase().includes(query) ||
      (node.fleet.description ?? '').toLowerCase().includes(query) ||
      (node.fleet.type ?? '').toLowerCase().includes(query));

  const filteredChildren = node.children
    .map((child) => filterFleetTree(child, query, productFilter))
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
  selectedFleet,
  onSelectFleet,
}: {
  node: FleetTreeNodeModel;
  expandedFleets: Set<string>;
  onToggleFleet: (fleetKey: string) => void;
  selectedFleet: Fleet | null;
  onSelectFleet: (fleet: Fleet) => void;
}) {
  const fleetKey = `${node.fleet.product}:${node.fleet.id}`;
  const isExpanded = expandedFleets.has(fleetKey);
  const isSelected =
    selectedFleet?.id === node.fleet.id && selectedFleet.product === node.fleet.product;

  return (
    <div className="tree-node">
      <button
        type="button"
        className={`tree-toggle${isExpanded ? ' tree-toggle-open' : ''}${isSelected ? ' tree-node-selected' : ''}`}
        onClick={() => {
          onSelectFleet(node.fleet);
          onToggleFleet(fleetKey);
        }}
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
          {node.children.length > 0 ? (
            <div className="tree-children">
              {node.children.map((child) => (
                <FleetTreeNode
                  key={`${child.fleet.product}:${child.fleet.id}`}
                  node={child}
                  expandedFleets={expandedFleets}
                  onToggleFleet={onToggleFleet}
                  selectedFleet={selectedFleet}
                  onSelectFleet={onSelectFleet}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
