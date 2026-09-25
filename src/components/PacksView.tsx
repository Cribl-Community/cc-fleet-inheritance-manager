import { useState, useMemo } from 'react';
import { Text, TextInput, Chip } from '@capra/core';
import { usePacks, usePackKnowledgeObjects } from '../hooks';
import { ErrorState, LoadingState, EmptyState, SkeletonLoader } from './LoadingState';
import type { Pack } from '../types';

export function PacksView() {
  const { data: packs, loading, error, retry } = usePacks();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const { data: knowledgeObjects, loading: koLoading } = usePackKnowledgeObjects(selectedPackId);

  const filteredPacks = useMemo(() => {
    if (!packs) return [];
    return packs.filter(pack =>
      (pack.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (pack.description?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (pack.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) || false)
    );
  }, [packs, searchTerm]);

  const selectedPack = packs?.find(p => p.id === selectedPackId);

  if (loading) return <SkeletonLoader count={5} />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!packs || packs.length === 0) {
    return <EmptyState title="No Packs Found" description="No packs are available in this environment." />;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
      <div>
        <Text as="h2" variant="heading">
          Packs
        </Text>
        <TextInput
          placeholder="Search packs..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ marginBottom: '1rem', marginTop: '0.5rem' }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '60vh', overflowY: 'auto' }}>
          {filteredPacks.map(pack => (
            <div
              key={pack.id}
              onClick={() => setSelectedPackId(pack.id)}
              style={{
                padding: '1rem',
                border: selectedPack?.id === pack.id ? '2px solid var(--ds-text-primary)' : '1px solid var(--ds-border-neutral)',
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: selectedPack?.id === pack.id ? 'var(--ds-background-neutral)' : 'transparent',
              }}
            >
              <Text variant="body-md-bold">{pack.displayName || pack.id}</Text>
              {pack.version && (
                <Text variant="body-sm" style={{ opacity: 0.7 }}>
                  v{pack.version}
                </Text>
              )}
              {pack.description && (
                <Text variant="body-sm" style={{ opacity: 0.7, marginTop: '0.25rem' }}>
                  {pack.description}
                </Text>
              )}
              {pack.tags && pack.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {pack.tags.slice(0, 3).map(tag => (
                    <Chip key={tag} variant="secondary" size="sm">
                      {tag}
                    </Chip>
                  ))}
                  {pack.tags.length > 3 && (
                    <Text variant="body-sm" style={{ opacity: 0.7 }}>
                      +{pack.tags.length - 3} more
                    </Text>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        {selectedPack ? (
          <div>
            <Text as="h2" variant="heading">
              Pack Details
            </Text>
            <div style={{ marginTop: '1rem' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <Text variant="body-sm" style={{ opacity: 0.7 }}>
                  ID
                </Text>
                <Text variant="body-md-bold">{selectedPack.id}</Text>
              </div>

              {selectedPack.version && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <Text variant="body-sm" style={{ opacity: 0.7 }}>
                    Version
                  </Text>
                  <Text variant="body-md">{selectedPack.version}</Text>
                </div>
              )}

              {selectedPack.author && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <Text variant="body-sm" style={{ opacity: 0.7 }}>
                    Author
                  </Text>
                  <Text variant="body-md">{selectedPack.author}</Text>
                </div>
              )}

              {selectedPack.description && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <Text variant="body-sm" style={{ opacity: 0.7 }}>
                    Description
                  </Text>
                  <Text variant="body-md">{selectedPack.description}</Text>
                </div>
              )}

              {selectedPack.tags && selectedPack.tags.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <Text variant="body-sm" style={{ opacity: 0.7 }}>
                    Tags
                  </Text>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    {selectedPack.tags.map(tag => (
                      <Chip key={tag} variant="secondary">
                        {tag}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: '2rem', borderTop: '1px solid var(--ds-border-neutral)', paddingTop: '1.5rem' }}>
                <Text as="h3" variant="heading-sm">
                  Knowledge Objects
                </Text>
                {koLoading ? (
                  <SkeletonLoader count={3} />
                ) : knowledgeObjects && knowledgeObjects.length > 0 ? (
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {knowledgeObjects.map(ko => (
                      <div
                        key={ko.id}
                        style={{
                          padding: '0.75rem',
                          backgroundColor: 'var(--ds-background-neutral)',
                          borderRadius: '4px',
                        }}
                      >
                        <Text variant="body-sm-bold">{ko.name}</Text>
                        <Chip variant="secondary" size="sm" style={{ marginTop: '0.25rem' }}>
                          {ko.type}
                        </Chip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text variant="body-sm" style={{ opacity: 0.7, marginTop: '0.5rem' }}>
                    No knowledge objects found
                  </Text>
                )}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Select a Pack" description="Click on a pack to view details" />
        )}
      </div>
    </div>
  );
}
