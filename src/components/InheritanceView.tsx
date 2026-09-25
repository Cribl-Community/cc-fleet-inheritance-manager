import { useState, useMemo } from 'react';
import { Text, TextInput } from '@capra/core';
import { useFleets, usePacks, useFleetPacks } from '../hooks';
import { ErrorState, LoadingState, EmptyState, SkeletonLoader } from './LoadingState';
import type { Fleet } from '../types';

export function InheritanceView() {
  const { data: fleets, loading: fleetsLoading, error: fleetsError, retry: retryFleets } = useFleets();
  const { data: packs, loading: packsLoading } = usePacks();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFleets, setExpandedFleets] = useState<Set<string>>(new Set());

  const filteredFleets = useMemo(() => {
    if (!fleets) return [];
    return fleets.filter(fleet =>
      fleet.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [fleets, searchTerm]);

  const toggleFleet = (fleetId: string) => {
    const newExpanded = new Set(expandedFleets);
    if (newExpanded.has(fleetId)) {
      newExpanded.delete(fleetId);
    } else {
      newExpanded.add(fleetId);
    }
    setExpandedFleets(newExpanded);
  };

  if (fleetsLoading || packsLoading) return <SkeletonLoader count={5} />;
  if (fleetsError) return <ErrorState error={fleetsError} onRetry={retryFleets} />;
  if (!fleets || fleets.length === 0) {
    return <EmptyState title="No Fleets Found" description="No fleets are configured in this environment." />;
  }

  return (
    <div>
      <Text as="h2" variant="heading">
        Fleet Pack Inheritance Hierarchy
      </Text>
      <Text variant="body-sm" style={{ opacity: 0.7, marginBottom: '1rem' }}>
        Expand each fleet to see the packs it inherits and their knowledge objects
      </Text>

      <TextInput
        placeholder="Search fleets..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        style={{ marginBottom: '1.5rem' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {filteredFleets.map(fleet => {
          const isExpanded = expandedFleets.has(fleet.id);
          return (
            <div key={fleet.id}>
              <div
                onClick={() => toggleFleet(fleet.id)}
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--ds-background-neutral)',
                  border: '1px solid var(--ds-border-neutral)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '1.2rem', width: '1.5rem', textAlign: 'center' }}>
                  {isExpanded ? '▼' : '▶'}
                </span>
                <div style={{ flex: 1 }}>
                  <Text variant="body-md-bold">{fleet.name}</Text>
                  {fleet.description && (
                    <Text variant="body-sm" style={{ opacity: 0.7 }}>
                      {fleet.description}
                    </Text>
                  )}
                </div>
              </div>

              {isExpanded && (
                <FleetPacksHierarchy fleetId={fleet.id} packs={packs} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FleetPacksHierarchy({ fleetId, packs }: { fleetId: string; packs: any[] | null }) {
  const { data: fleetPacks, loading } = useFleetPacks(fleetId);
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

  if (loading) return <SkeletonLoader count={3} />;
  if (!fleetPacks || fleetPacks.length === 0) {
    return (
      <div style={{ paddingLeft: '2rem', marginTop: '0.5rem' }}>
        <Text variant="body-sm" style={{ opacity: 0.7 }}>
          No packs inherited
        </Text>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: '2rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {fleetPacks.map(pack => {
        const isExpanded = expandedPacks.has(pack.id);
        return (
          <div key={pack.id}>
            <div
              onClick={() => togglePack(pack.id)}
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--ds-background)',
                border: '1px solid var(--ds-border-neutral)',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '1rem', width: '1rem', textAlign: 'center' }}>
                {isExpanded ? '▼' : '▶'}
              </span>
              <div style={{ flex: 1 }}>
                <Text variant="body-sm-bold">{pack.displayName || pack.id}</Text>
                {pack.version && (
                  <Text variant="body-xs" style={{ opacity: 0.7 }}>
                    v{pack.version}
                  </Text>
                )}
              </div>
            </div>

            {isExpanded && (
              <PackKnowledgeObjectsList packId={pack.id} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PackKnowledgeObjectsList({ packId }: { packId: string }) {
  const { data: knowledgeObjects, loading } = usePackKnowledgeObjects(packId);

  if (loading) return <SkeletonLoader count={2} />;
  if (!knowledgeObjects || knowledgeObjects.length === 0) {
    return (
      <div style={{ paddingLeft: '2rem', marginTop: '0.25rem' }}>
        <Text variant="body-xs" style={{ opacity: 0.7 }}>
          No knowledge objects
        </Text>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: '2rem', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {knowledgeObjects.slice(0, 10).map(ko => (
        <div
          key={ko.id}
          style={{
            padding: '0.5rem 0.75rem',
            backgroundColor: 'var(--ds-background-neutral)',
            borderRadius: '3px',
            fontSize: '0.875rem',
          }}
        >
          <Text variant="body-xs">
            <span style={{ opacity: 0.7 }}>●</span> {ko.name}{' '}
            <span style={{ opacity: 0.5, marginLeft: '0.5rem' }}>({ko.type})</span>
          </Text>
        </div>
      ))}
      {knowledgeObjects.length > 10 && (
        <Text variant="body-xs" style={{ paddingLeft: '1rem', opacity: 0.7 }}>
          +{knowledgeObjects.length - 10} more
        </Text>
      )}
    </div>
  );
}
