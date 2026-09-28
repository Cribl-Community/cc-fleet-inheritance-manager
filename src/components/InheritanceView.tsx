import { useEffect, useMemo, useState } from 'react';
import { Text } from '@capra/core';
import { useFleetPacks, useFleets, useKnowledgeObjectPreview, usePackKnowledgeObjects } from '../hooks';
import type { Fleet, FleetProduct, KnowledgeObject, Pack } from '../types';
import { ErrorState } from './ErrorBoundary';
import { FleetProductBadge } from './FleetProductBadge';
import { KnowledgeObjectGroups } from './KnowledgeObjectGroups';
import { EmptyState, SkeletonLoader } from './LoadingState';

const KNOWLEDGE_OBJECT_TYPES = ['all', 'lookup', 'pipeline', 'route'] as const;
const INHERITANCE_CHART_MODES = ['tree', 'levels', 'paths', 'sankey'] as const;
type KnowledgeObjectTypeFilter = (typeof KNOWLEDGE_OBJECT_TYPES)[number];
type KnowledgeObjectSortMode = 'name-asc' | 'name-desc';
type InheritanceChartMode = (typeof INHERITANCE_CHART_MODES)[number];
type FleetProductFilter = 'all' | FleetProduct;

const SANKEY_COLUMN_WIDTH = 220;
const SANKEY_COLUMN_GAP = 72;
const SANKEY_NODE_HEIGHT = 96;
const SANKEY_NODE_GAP = 16;
const SANKEY_PADDING = 16;

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

interface FleetDepthColumn {
  depth: number;
  fleets: FleetTreeNodeModel[];
}

interface FleetLineageRow {
  fleet: Fleet;
  lineage: Fleet[];
  childCount: number;
}

interface SankeyNodeLayout {
  key: string;
  fleet: Fleet;
  parentName: string | null;
  depth: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  childCount: number;
}

interface SankeyLinkLayout {
  key: string;
  sourceKey: string;
  targetKey: string;
  sourceName: string;
  targetName: string;
  path: string;
}

interface InheritanceSankeyLayout {
  nodes: SankeyNodeLayout[];
  links: SankeyLinkLayout[];
  width: number;
  height: number;
}

export function InheritanceView() {
  const { data: fleets, loading: fleetsLoading, error: fleetsError, retry: retryFleets } = useFleets();
  const [searchTerm, setSearchTerm] = useState('');
  const [chartMode, setChartMode] = useState<InheritanceChartMode>('tree');
  const [productFilter, setProductFilter] = useState<FleetProductFilter>('all');
  const [expandedFleets, setExpandedFleets] = useState<Set<string>>(new Set());
  const [knowledgeObjectTypeFilter, setKnowledgeObjectTypeFilter] = useState<KnowledgeObjectTypeFilter>('all');
  const [knowledgeObjectSortMode, setKnowledgeObjectSortMode] = useState<KnowledgeObjectSortMode>('name-asc');
  const [packInventoryByKey, setPackInventoryByKey] = useState<Map<string, KnowledgeObject[]>>(new Map());

  const fleetLookupById = useMemo(() => {
    if (!fleets) {
      return new Map<string, Fleet>();
    }

    return new Map(fleets.map((fleet) => [fleet.id, fleet]));
  }, [fleets]);

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
      return fleetForest
        .map((node) => filterFleetTree(node, query, productFilter))
        .filter((node): node is FleetTreeNodeModel => node !== null);
    }

    return fleetForest
      .map((node) => filterFleetTree(node, query, productFilter))
      .filter((node): node is FleetTreeNodeModel => node !== null);
  }, [fleetForest, productFilter, searchTerm]);

  const totalVisibleFleets = useMemo(() => countFleetNodes(filteredFleetForest), [filteredFleetForest]);

  const fleetDepthColumns = useMemo(() => buildFleetDepthColumns(filteredFleetForest), [filteredFleetForest]);

  const fleetLineageRows = useMemo(() => buildFleetLineageRows(filteredFleetForest), [filteredFleetForest]);

  const sankeyLayout = useMemo(() => buildInheritanceSankeyLayout(filteredFleetForest), [filteredFleetForest]);

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
            Switch between a detailed drill-down tree and three chart-styled inheritance summaries.
          </Text>
        </div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <Text variant="body-xs-semibold" color="secondary">
          View mode
        </Text>
        <div className="pill-row" style={{ marginTop: '0.35rem' }}>
          {INHERITANCE_CHART_MODES.map((mode) => {
            const isSelected = chartMode === mode;
            const label =
              mode === 'tree'
                ? 'Detailed tree'
                : mode === 'levels'
                  ? 'Levels chart'
                  : mode === 'paths'
                    ? 'Lineage chart'
                    : 'Sankey chart';

            return (
              <button
                key={mode}
                type="button"
                className={`pill${isSelected ? '' : ' pill-subtle'}`}
                onClick={() => setChartMode(mode)}
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

      {chartMode === 'tree' ? (
        <>
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
        </>
      ) : null}

      <input
        className="search-input"
        type="search"
        placeholder="Search fleets"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
      />

      <InheritanceSummary
        totalFleets={totalVisibleFleets}
        rootCount={filteredFleetForest.length}
        deepestLevel={fleetDepthColumns.length}
        currentMode={chartMode}
      />

      {filteredFleetForest.length === 0 ? (
        <EmptyState
          title="No fleets match this search"
          description="Try a different fleet name or description fragment."
        />
      ) : null}

      {filteredFleetForest.length > 0 && chartMode === 'tree' ? (
        <div className="list-stack">
          {filteredFleetForest.map((node) => (
            <FleetTreeNode
              key={`${node.fleet.product}:${node.fleet.id}`}
              node={node}
              expandedFleets={expandedFleets}
              onToggleFleet={toggleFleet}
              knowledgeObjectTypeFilter={knowledgeObjectTypeFilter}
              knowledgeObjectSortMode={knowledgeObjectSortMode}
              packInventoryByKey={packInventoryByKey}
              setPackInventoryByKey={setPackInventoryByKey}
              fleetLookupById={fleetLookupById}
            />
          ))}
        </div>
      ) : null}

      {filteredFleetForest.length > 0 && chartMode === 'levels' ? (
        <InheritanceLevelsChart columns={fleetDepthColumns} fleetLookupById={fleetLookupById} />
      ) : null}

      {filteredFleetForest.length > 0 && chartMode === 'paths' ? (
        <InheritanceLineageChart rows={fleetLineageRows} fleetLookupById={fleetLookupById} />
      ) : null}

      {filteredFleetForest.length > 0 && chartMode === 'sankey' ? (
        <InheritanceSankeyChart layout={sankeyLayout} />
      ) : null}
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
  productFilter: FleetProductFilter,
): FleetTreeNodeModel | null {
  const matchesProduct = productFilterMatches(node.fleet.product, productFilter);
  const matchesSelf =
    node.fleet.name.toLowerCase().includes(query) ||
    (node.fleet.description ?? '').toLowerCase().includes(query);

  const filteredChildren = node.children
    .map((child) => filterFleetTree(child, query, productFilter))
    .filter((child): child is FleetTreeNodeModel => child !== null);

  if ((!matchesSelf || !matchesProduct) && filteredChildren.length === 0) {
    return null;
  }

  return {
    fleet: node.fleet,
    children: filteredChildren,
  };
}

function productFilterMatches(product: FleetProduct, filter: FleetProductFilter): boolean {
  return filter === 'all' || product === filter;
}

function countFleetNodes(nodes: FleetTreeNodeModel[]): number {
  return nodes.reduce((total, node) => total + 1 + countFleetNodes(node.children), 0);
}

function buildFleetDepthColumns(forest: FleetTreeNodeModel[]): FleetDepthColumn[] {
  const columns = new Map<number, FleetTreeNodeModel[]>();

  const visit = (node: FleetTreeNodeModel, depth: number) => {
    const existing = columns.get(depth) ?? [];
    existing.push(node);
    columns.set(depth, existing);
    node.children.forEach((child) => visit(child, depth + 1));
  };

  forest.forEach((node) => visit(node, 0));

  return Array.from(columns.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([depth, fleets]) => ({ depth, fleets }));
}

function buildFleetLineageRows(forest: FleetTreeNodeModel[]): FleetLineageRow[] {
  const rows: FleetLineageRow[] = [];

  const visit = (node: FleetTreeNodeModel, lineage: Fleet[]) => {
    const nextLineage = [...lineage, node.fleet];
    rows.push({
      fleet: node.fleet,
      lineage: nextLineage,
      childCount: node.children.length,
    });
    node.children.forEach((child) => visit(child, nextLineage));
  };

  forest.forEach((node) => visit(node, []));

  return rows;
}

function buildInheritanceSankeyLayout(forest: FleetTreeNodeModel[]): InheritanceSankeyLayout {
  const depthColumns = buildFleetDepthColumns(forest);
  const nodes: SankeyNodeLayout[] = depthColumns.flatMap((column) =>
    column.fleets.map((node, row) => ({
      key: `${node.fleet.product}:${node.fleet.id}`,
      fleet: node.fleet,
      parentName: null,
      depth: column.depth,
      row,
      x: SANKEY_PADDING + column.depth * (SANKEY_COLUMN_WIDTH + SANKEY_COLUMN_GAP),
      y: SANKEY_PADDING + row * (SANKEY_NODE_HEIGHT + SANKEY_NODE_GAP),
      width: SANKEY_COLUMN_WIDTH,
      height: SANKEY_NODE_HEIGHT,
      childCount: node.children.length,
    })),
  );

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));

  nodes.forEach((node) => {
    if (!node.fleet.parentId) {
      return;
    }

    const parentNode = nodeByKey.get(`${node.fleet.product}:${node.fleet.parentId}`);
    node.parentName = parentNode?.fleet.name ?? node.fleet.parentId;
  });

  const links: SankeyLinkLayout[] = [];

  const visit = (node: FleetTreeNodeModel) => {
    const sourceKey = `${node.fleet.product}:${node.fleet.id}`;
    const sourceNode = nodeByKey.get(sourceKey);

    node.children.forEach((child) => {
      const targetKey = `${child.fleet.product}:${child.fleet.id}`;
      const targetNode = nodeByKey.get(targetKey);

      if (sourceNode && targetNode) {
        const sourceX = sourceNode.x + sourceNode.width;
        const sourceY = sourceNode.y + sourceNode.height / 2;
        const targetX = targetNode.x;
        const targetY = targetNode.y + targetNode.height / 2;
        const controlOffset = Math.max((targetX - sourceX) * 0.45, 36);

        links.push({
          key: `${sourceKey}->${targetKey}`,
          sourceKey,
          targetKey,
          sourceName: sourceNode.fleet.name,
          targetName: targetNode.fleet.name,
          path: `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`,
        });
      }

      visit(child);
    });
  };

  forest.forEach((node) => visit(node));

  const width = Math.max(
    SANKEY_PADDING * 2 + SANKEY_COLUMN_WIDTH,
    SANKEY_PADDING * 2 + depthColumns.length * SANKEY_COLUMN_WIDTH + Math.max(depthColumns.length - 1, 0) * SANKEY_COLUMN_GAP,
  );
  const tallestColumn = depthColumns.reduce((maxHeight, column) => {
    const columnHeight = column.fleets.length * SANKEY_NODE_HEIGHT + Math.max(column.fleets.length - 1, 0) * SANKEY_NODE_GAP;
    return Math.max(maxHeight, columnHeight);
  }, 0);
  const height = Math.max(SANKEY_PADDING * 2 + SANKEY_NODE_HEIGHT, SANKEY_PADDING * 2 + tallestColumn);

  return {
    nodes,
    links,
    width,
    height,
  };
}

function wrapSankeyDescription(description: string | undefined, maxLineLength = 30): string[] {
  if (!description) {
    return [];
  }

  const normalized = description.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return [];
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= maxLineLength) {
      currentLine = nextLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    lines.push(word.slice(0, maxLineLength - 1) + '…');
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 2).map((line, index, source) => {
    if (index === source.length - 1 && lines.length > 2) {
      return `${line.slice(0, Math.max(0, maxLineLength - 1)).trimEnd()}…`;
    }

    return line;
  });
}

function InheritanceSummary({
  totalFleets,
  rootCount,
  deepestLevel,
  currentMode,
}: {
  totalFleets: number;
  rootCount: number;
  deepestLevel: number;
  currentMode: InheritanceChartMode;
}) {
  return (
    <div className="inheritance-summary-grid">
      <div className="inheritance-summary-card">
        <Text variant="body-xs-semibold" color="secondary">
          Fleets in view
        </Text>
        <Text as="div" variant="heading-md">
          {totalFleets}
        </Text>
      </div>
      <div className="inheritance-summary-card">
        <Text variant="body-xs-semibold" color="secondary">
          Root fleets
        </Text>
        <Text as="div" variant="heading-md">
          {rootCount}
        </Text>
      </div>
      <div className="inheritance-summary-card">
        <Text variant="body-xs-semibold" color="secondary">
          Depth
        </Text>
        <Text as="div" variant="heading-md">
          {deepestLevel}
        </Text>
      </div>
      <div className="inheritance-summary-card">
        <Text variant="body-xs-semibold" color="secondary">
          Active chart
        </Text>
        <Text as="div" variant="heading-sm">
          {currentMode === 'tree'
            ? 'Detailed tree'
            : currentMode === 'levels'
              ? 'Levels chart'
              : currentMode === 'paths'
                ? 'Lineage chart'
                : 'Sankey chart'}
        </Text>
      </div>
    </div>
  );
}

function InheritanceLevelsChart({
  columns,
  fleetLookupById,
}: {
  columns: FleetDepthColumn[];
  fleetLookupById: Map<string, Fleet>;
}) {
  return (
    <div className="inheritance-levels-chart" role="list" aria-label="Fleet inheritance levels chart">
      {columns.map((column) => (
        <section key={column.depth} className="inheritance-level-column" role="listitem">
          <div className="inheritance-level-header">
            <Text variant="body-xs-semibold" color="secondary">
              Level {column.depth + 1}
            </Text>
            <Text variant="body-sm-normal" color="secondary">
              {column.fleets.length} fleet{column.fleets.length === 1 ? '' : 's'}
            </Text>
          </div>

          <div className="inheritance-level-cards">
            {column.fleets.map((node) => {
              const parentFleet = node.fleet.parentId ? fleetLookupById.get(node.fleet.parentId) : undefined;

              return (
                <article key={`${node.fleet.product}:${node.fleet.id}`} className="inheritance-chart-card">
                  <div className="list-card-header">
                    <Text variant="body-md-semibold">{node.fleet.name}</Text>
                    <FleetProductBadge product={node.fleet.product} />
                  </div>
                  <div className="inheritance-parent-link" aria-label={parentFleet ? `Parent fleet ${parentFleet.name}` : 'Root fleet'}>
                    <span className="inheritance-parent-link-label">{parentFleet ? 'Inherits from' : 'Root fleet'}</span>
                    <span className="inheritance-parent-link-value">{parentFleet?.name ?? 'No parent'}</span>
                  </div>
                  <div className="section-copy">
                    <Text variant="body-xs-normal" color="secondary">
                      {node.children.length === 0
                        ? 'Leaf fleet'
                        : `${node.children.length} direct child${node.children.length === 1 ? '' : 'ren'}`}
                    </Text>
                  </div>
                  {node.fleet.description ? (
                    <div className="section-copy">
                      <Text variant="body-sm-normal" color="secondary">
                        {node.fleet.description}
                      </Text>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function InheritanceLineageChart({
  rows,
  fleetLookupById,
}: {
  rows: FleetLineageRow[];
  fleetLookupById: Map<string, Fleet>;
}) {
  return (
    <div className="inheritance-lineage-chart">
      {rows.map((row) => {
        const parentFleet = row.fleet.parentId ? fleetLookupById.get(row.fleet.parentId) : undefined;

        return (
          <article key={`${row.fleet.product}:${row.fleet.id}`} className="inheritance-lineage-row">
            <div className="inheritance-lineage-track" aria-hidden="true" />
            <div className="inheritance-lineage-sequence">
              {row.lineage.map((fleet, index) => {
                const isTerminal = index === row.lineage.length - 1;
                const directParent = index > 0 ? row.lineage[index - 1] : undefined;

                return (
                  <div key={`${fleet.product}:${fleet.id}`} className="inheritance-lineage-node-wrap">
                    <div className={`inheritance-lineage-node${isTerminal ? ' inheritance-lineage-node-terminal' : ''}`}>
                      <Text variant="body-sm-semibold">{fleet.name}</Text>
                      <div className="section-copy">
                        <FleetProductBadge product={fleet.product} />
                      </div>
                      <div className="inheritance-lineage-parent-copy">
                        <Text variant="body-xs-normal" color="secondary">
                          {directParent ? `Parent: ${directParent.name}` : 'Parent: none'}
                        </Text>
                      </div>
                    </div>
                    {index < row.lineage.length - 1 ? <div className="inheritance-lineage-connector" aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
            <div className="inheritance-lineage-meta">
              <Text variant="body-xs-semibold" color="secondary">
                {parentFleet ? `Current fleet inherits from ${parentFleet.name}` : 'Root lineage'}
              </Text>
              <Text variant="body-xs-normal" color="secondary">
                {row.childCount === 0 ? 'Leaf lineage' : `${row.childCount} downstream branch${row.childCount === 1 ? '' : 'es'}`}
              </Text>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function InheritanceSankeyChart({ layout }: { layout: InheritanceSankeyLayout }) {
  return (
    <div className="inheritance-sankey-shell">
      <div className="inheritance-sankey-caption">
        <Text variant="body-sm-normal" color="secondary">
          Flow lines show parent fleets passing inheritance downstream into child fleets.
        </Text>
      </div>

      <div className="inheritance-sankey-scroll">
        <svg
          className="inheritance-sankey-svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Fleet inheritance Sankey chart"
          preserveAspectRatio="xMinYMin meet"
        >
          {layout.links.map((link) => (
            <path
              key={link.key}
              d={link.path}
              className="inheritance-sankey-link"
            >
              <title>{`${link.sourceName} inherits into ${link.targetName}`}</title>
            </path>
          ))}

          {layout.nodes.map((node) => (
            (() => {
              const descriptionLines = wrapSankeyDescription(node.fleet.description);

              return (
                <g key={node.key} transform={`translate(${node.x}, ${node.y})`}>
                  <rect
                    className="inheritance-sankey-node"
                    width={node.width}
                    height={node.height}
                    rx="14"
                    ry="14"
                  />
                  <rect
                    className="inheritance-sankey-node-accent"
                    width="8"
                    height={node.height}
                    rx="14"
                    ry="14"
                  />
                  <text x="18" y="24" className="inheritance-sankey-node-title">
                    {node.fleet.name}
                  </text>
                  <text x="18" y="44" className="inheritance-sankey-node-meta">
                    {node.parentName ? `Parent: ${node.parentName}` : 'Root fleet'}
                  </text>
                  <text x={node.width - 18} y="44" textAnchor="end" className="inheritance-sankey-node-meta">
                    {node.childCount === 0 ? 'Leaf' : `${node.childCount} child${node.childCount === 1 ? '' : 'ren'}`}
                  </text>
                  {descriptionLines.length > 0 ? (
                    <text x="18" y="66" className="inheritance-sankey-node-description">
                      {descriptionLines.map((line, index) => (
                        <tspan key={`${node.key}:description:${index}`} x="18" dy={index === 0 ? 0 : 14}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  ) : null}
                  <title>
                    {node.parentName
                      ? `${node.fleet.name} inherits from ${node.parentName}${node.fleet.description ? `. ${node.fleet.description}` : ''}`
                      : `${node.fleet.name} is a root fleet${node.fleet.description ? `. ${node.fleet.description}` : ''}`}
                  </title>
                </g>
              );
            })()
          ))}
        </svg>
      </div>
    </div>
  );
}

function FleetTreeNode({
  node,
  expandedFleets,
  onToggleFleet,
  knowledgeObjectTypeFilter,
  knowledgeObjectSortMode,
  packInventoryByKey,
  setPackInventoryByKey,
  fleetLookupById,
}: {
  node: FleetTreeNodeModel;
  expandedFleets: Set<string>;
  onToggleFleet: (fleetId: string) => void;
  knowledgeObjectTypeFilter: KnowledgeObjectTypeFilter;
  knowledgeObjectSortMode: KnowledgeObjectSortMode;
  packInventoryByKey: Map<string, KnowledgeObject[]>;
  setPackInventoryByKey: React.Dispatch<React.SetStateAction<Map<string, KnowledgeObject[]>>>;
  fleetLookupById: Map<string, Fleet>;
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
            fleetName={node.fleet.name}
            fleetParentId={node.fleet.parentId}
            product={node.fleet.product}
            knowledgeObjectTypeFilter={knowledgeObjectTypeFilter}
            knowledgeObjectSortMode={knowledgeObjectSortMode}
            packInventoryByKey={packInventoryByKey}
            setPackInventoryByKey={setPackInventoryByKey}
            fleetLookupById={fleetLookupById}
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
                  packInventoryByKey={packInventoryByKey}
                  setPackInventoryByKey={setPackInventoryByKey}
                  fleetLookupById={fleetLookupById}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildKnowledgeObjectKey(knowledgeObject: Pick<KnowledgeObject, 'type' | 'id'>): string {
  return `${knowledgeObject.type}:${knowledgeObject.id}`;
}

function compareKnowledgeObjectInventory(
  parentInventory: KnowledgeObject[] | null | undefined,
  childInventory: KnowledgeObject[] | null | undefined,
): { added: KnowledgeObject[]; removed: KnowledgeObject[]; matching: KnowledgeObject[] } {
  const parentByKey = new Map<string, KnowledgeObject>();
  const childByKey = new Map<string, KnowledgeObject>();

  (parentInventory ?? []).forEach((knowledgeObject) => {
    parentByKey.set(buildKnowledgeObjectKey(knowledgeObject), knowledgeObject);
  });

  (childInventory ?? []).forEach((knowledgeObject) => {
    childByKey.set(buildKnowledgeObjectKey(knowledgeObject), knowledgeObject);
  });

  const added: KnowledgeObject[] = [];
  const removed: KnowledgeObject[] = [];
  const matching: KnowledgeObject[] = [];

  childByKey.forEach((knowledgeObject, key) => {
    if (!parentByKey.has(key)) {
      added.push(knowledgeObject);
      return;
    }

    matching.push(knowledgeObject);
  });

  parentByKey.forEach((knowledgeObject, key) => {
    if (!childByKey.has(key)) {
      removed.push(knowledgeObject);
    }
  });

  return { added, removed, matching };
}

function pickAncestorSourceGroup(
  pack: Pack,
  currentFleetId: string,
  currentFleetParentId?: string,
): string | undefined {
  const candidates = Array.from(
    new Set(
      [pack.inheritedFrom, ...(pack.groupIds ?? []), currentFleetParentId]
        .filter((value): value is string => Boolean(value))
        .filter((value) => value !== currentFleetId && value !== pack.id && value !== 'default'),
    ),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  return pack.inheritedFrom && candidates.includes(pack.inheritedFrom)
    ? pack.inheritedFrom
    : candidates[0];
}

function evaluatePackStatus(
  pack: Pack,
  childKnowledgeObjects: KnowledgeObject[] | null | undefined,
  ancestorKnowledgeObjects: KnowledgeObject[] | null | undefined,
  ancestorSourceGroupId: string | undefined,
): Pack['status'] {
  if (pack.configDrift || pack.inheritedModified) {
    return 'inherited-modified';
  }

  const hasInheritedSource = Boolean(pack.inheritedFrom || (pack.groupIds && pack.groupIds.length > 0));

  if (!hasInheritedSource) {
    return 'local';
  }

  if (!ancestorSourceGroupId) {
    return 'unknown';
  }

  if (!ancestorKnowledgeObjects || ancestorKnowledgeObjects.length === 0) {
    return 'unknown';
  }

  if (!childKnowledgeObjects) {
    return 'unknown';
  }

  const diff = compareKnowledgeObjectInventory(ancestorKnowledgeObjects, childKnowledgeObjects);

  if (diff.added.length > 0 || diff.removed.length > 0) {
    return 'inherited-modified';
  }

  return 'inherited';
}

function PackInheritanceBadge({
  pack,
  fleetId,
  fleetName,
  fleetParentId,
  packInventoryByKey,
  fleetLookupById,
}: {
  pack: Pack;
  fleetId: string;
  fleetName: string;
  fleetParentId?: string;
  packInventoryByKey: Map<string, KnowledgeObject[]>;
  fleetLookupById: Map<string, Fleet>;
}) {
  const inheritedSourceGroupId = pickAncestorSourceGroup(pack, fleetId, fleetParentId);
  const inheritedSourceFleet = inheritedSourceGroupId ? fleetLookupById.get(inheritedSourceGroupId) : undefined;
  const childInventoryKey = `${fleetId}:${pack.id}`;
  const ancestorInventoryKey = inheritedSourceGroupId ? `${inheritedSourceGroupId}:${pack.id}` : undefined;
  const childKnowledgeObjects = packInventoryByKey.get(childInventoryKey) ?? [];
  const ancestorKnowledgeObjects = ancestorInventoryKey ? packInventoryByKey.get(ancestorInventoryKey) : undefined;

  const status = useMemo(
    () => evaluatePackStatus(pack, childKnowledgeObjects, ancestorKnowledgeObjects, inheritedSourceGroupId),
    [ancestorKnowledgeObjects, childKnowledgeObjects, inheritedSourceGroupId, pack],
  );

  const debugInfo = {
    fleetId,
    fleetName,
    parentId: fleetParentId ?? '—',
    packId: pack.id,
    packDisplayName: pack.displayName ?? pack.id,
    packInheritedFrom: pack.inheritedFrom ?? '—',
    packGroupIds: pack.groupIds && pack.groupIds.length > 0 ? pack.groupIds.join(', ') : '—',
    resolvedAncestorId: inheritedSourceGroupId ?? '—',
    resolvedAncestorName: inheritedSourceFleet?.name ?? '—',
  };

  const debugText = `[debug] ${JSON.stringify(debugInfo)} | Child Objects: ${childKnowledgeObjects.length} | Ancestor Objects: ${ancestorKnowledgeObjects?.length ?? 0} | Status: ${status}`;

  console.debug('[inheritance-ancestor-discovery]', debugInfo);

  if (status === 'inherited-modified') {
    return (
      <>
        <span className="inheritance-pill">Inherited modified</span>
        <div className="section-copy" style={{ marginTop: '0.25rem' }}>
          <Text variant="body-xs-normal" color="secondary">{debugText}</Text>
        </div>
      </>
    );
  }

  if (status === 'inherited') {
    return (
      <>
        <span className="inheritance-pill">Inherited</span>
        <div className="section-copy" style={{ marginTop: '0.25rem' }}>
          <Text variant="body-xs-normal" color="secondary">{debugText}</Text>
        </div>
      </>
    );
  }

  if (status === 'unknown') {
    return (
      <>
        <span className="pill pill-subtle">Verification pending</span>
        <div className="section-copy" style={{ marginTop: '0.25rem' }}>
          <Text variant="body-xs-normal" color="secondary">{debugText}</Text>
        </div>
      </>
    );
  }

  return (
    <>
      <span className="pill pill-subtle">Local</span>
      <div className="section-copy" style={{ marginTop: '0.25rem' }}>
        <Text variant="body-xs-normal" color="secondary">{debugText}</Text>
      </div>
    </>
  );
}

function FleetPacksHierarchy({
  fleetId,
  fleetName,
  fleetParentId,
  product,
  knowledgeObjectTypeFilter,
  knowledgeObjectSortMode,
  packInventoryByKey,
  setPackInventoryByKey,
  fleetLookupById,
}: {
  fleetId: string;
  fleetName: string;
  fleetParentId?: string;
  product: FleetProduct;
  knowledgeObjectTypeFilter: KnowledgeObjectTypeFilter;
  knowledgeObjectSortMode: KnowledgeObjectSortMode;
  packInventoryByKey: Map<string, KnowledgeObject[]>;
  setPackInventoryByKey: React.Dispatch<React.SetStateAction<Map<string, KnowledgeObject[]>>>;
  fleetLookupById: Map<string, Fleet>;
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
                <div className="list-card-header">
                  <Text variant="body-sm-semibold">{pack.displayName || pack.id}</Text>
                  <PackInheritanceBadge
                    pack={pack}
                    fleetId={fleetId}
                    fleetName={fleetName}
                    fleetParentId={fleetParentId}
                    packInventoryByKey={packInventoryByKey}
                    fleetLookupById={fleetLookupById}
                  />
                </div>
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
                setPackInventoryByKey={setPackInventoryByKey}
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
  setPackInventoryByKey,
}: {
  packId: string;
  fleetId: string;
  knowledgeObjectTypeFilter: KnowledgeObjectTypeFilter;
  knowledgeObjectSortMode: KnowledgeObjectSortMode;
  setPackInventoryByKey: React.Dispatch<React.SetStateAction<Map<string, KnowledgeObject[]>>>;
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
    if (!knowledgeObjects) {
      return;
    }

    setPackInventoryByKey((current) => {
      const next = new Map(current);
      next.set(`${fleetId}:${packId}`, knowledgeObjects);
      return next;
    });
  }, [fleetId, knowledgeObjects, packId, setPackInventoryByKey]);

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
            {!previewLoading && !previewError && preview?.kind === 'route' ? (
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
            ) : null}
          </>
        )}
      />
    </div>
  );
}
