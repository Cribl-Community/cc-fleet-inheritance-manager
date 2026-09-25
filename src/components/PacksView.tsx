import { useEffect, useMemo, useState } from 'react';
import { Text } from '@capra/core';
import type { KnowledgeObject } from '../types';
import { useKnowledgeObjectPreview, usePacks, usePackKnowledgeObjects } from '../hooks';
import { ErrorState } from './ErrorBoundary';
import { KnowledgeObjectGroups } from './KnowledgeObjectGroups';
import { EmptyState, SkeletonLoader } from './LoadingState';

const KNOWLEDGE_OBJECT_TYPES = ['all', 'lookup', 'pipeline', 'route'] as const;
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

export function PacksView() {
  const { data: packs, loading, error, retry } = usePacks();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const {
    data: knowledgeObjects,
    loading: koLoading,
    error: knowledgeError,
    retry: retryKnowledge,
  } = usePackKnowledgeObjects(selectedPackId);
  const [selectedKnowledgeObject, setSelectedKnowledgeObject] = useState<KnowledgeObject | null>(null);
  const [knowledgeObjectTypeFilter, setKnowledgeObjectTypeFilter] = useState<KnowledgeObjectTypeFilter>('all');
  const [knowledgeObjectSortMode, setKnowledgeObjectSortMode] = useState<KnowledgeObjectSortMode>('name-asc');
  const {
    data: preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview,
  } = useKnowledgeObjectPreview(selectedPackId, selectedKnowledgeObject);

  const visibleKnowledgeObjects = useMemo(() => {
    if (!knowledgeObjects) {
      return [];
    }

    const filtered = knowledgeObjectTypeFilter === 'all'
      ? knowledgeObjects
      : knowledgeObjects.filter((knowledgeObject) => knowledgeObject.type === knowledgeObjectTypeFilter);

    return sortKnowledgeObjectsByName(filtered, knowledgeObjectSortMode);
  }, [knowledgeObjectSortMode, knowledgeObjectTypeFilter, knowledgeObjects]);

  const filteredPacks = useMemo(() => {
    if (!packs) {
      return [];
    }

    const query = searchTerm.trim().toLowerCase();

    return packs.filter((pack) => {
      if (!query) {
        return true;
      }

      return (
        (pack.displayName ?? '').toLowerCase().includes(query) ||
        (pack.description ?? '').toLowerCase().includes(query) ||
        pack.id.toLowerCase().includes(query) ||
        (pack.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false)
      );
    });
  }, [packs, searchTerm]);

  const selectedPack = packs?.find(p => p.id === selectedPackId);

  useEffect(() => {
    setSelectedKnowledgeObject(null);
  }, [selectedPackId]);

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

        <input
          className="search-input"
          type="search"
          placeholder="Search packs"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <div className="list-stack list-stack-scroll">
          {filteredPacks.map((pack) => {
            const inheritanceLabel =
              pack.status === 'inherited-modified' ? 'Inherited modified' :
              pack.status === 'inherited' ? 'Inherited' : null;

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
                  Metadata and knowledge objects for the selected pack.
                </Text>
              </div>
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
                    Inheritance
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
                    Version
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
