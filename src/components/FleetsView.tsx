import { useState, useMemo } from 'react';
import { Text, TextInput, Table, Chip } from '@capra/core';
import { useFleets } from '../hooks';
import { ErrorState, LoadingState, EmptyState, SkeletonLoader } from './LoadingState';
import type { Fleet } from '../types';

export function FleetsView() {
  const { data: fleets, loading, error, retry } = useFleets();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFleet, setSelectedFleet] = useState<Fleet | null>(null);

  const filteredFleets = useMemo(() => {
    if (!fleets) return [];
    return fleets.filter(fleet =>
      fleet.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (fleet.description?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );
  }, [fleets, searchTerm]);

  if (loading) return <SkeletonLoader count={5} />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!fleets || fleets.length === 0) {
    return <EmptyState title="No Fleets Found" description="No fleets are configured in this environment." />;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
      <div>
        <Text as="h2" variant="heading">
          Fleets
        </Text>
        <TextInput
          placeholder="Search fleets..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ marginBottom: '1rem', marginTop: '0.5rem' }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filteredFleets.map(fleet => (
            <div
              key={fleet.id}
              onClick={() => setSelectedFleet(fleet)}
              style={{
                padding: '1rem',
                border: selectedFleet?.id === fleet.id ? '2px solid var(--ds-text-primary)' : '1px solid var(--ds-border-neutral)',
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: selectedFleet?.id === fleet.id ? 'var(--ds-background-neutral)' : 'transparent',
              }}
            >
              <Text variant="body-md-bold">{fleet.name}</Text>
              {fleet.description && (
                <Text variant="body-sm" style={{ opacity: 0.7, marginTop: '0.25rem' }}>
                  {fleet.description}
                </Text>
              )}
              {fleet.type && (
                <Chip variant="secondary" style={{ marginTop: '0.5rem' }}>
                  {fleet.type}
                </Chip>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        {selectedFleet ? (
          <div>
            <Text as="h2" variant="heading">
              Fleet Details
            </Text>
            <div style={{ marginTop: '1rem' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <Text variant="body-sm" style={{ opacity: 0.7 }}>
                  ID
                </Text>
                <Text variant="body-md-bold">{selectedFleet.id}</Text>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <Text variant="body-sm" style={{ opacity: 0.7 }}>
                  Type
                </Text>
                <Text variant="body-md">{selectedFleet.type || 'N/A'}</Text>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <Text variant="body-sm" style={{ opacity: 0.7 }}>
                  Description
                </Text>
                <Text variant="body-md">{selectedFleet.description || 'No description'}</Text>
              </div>

              {selectedFleet.deployedVersion && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <Text variant="body-sm" style={{ opacity: 0.7 }}>
                    Deployed Version
                  </Text>
                  <Text variant="body-md">{selectedFleet.deployedVersion}</Text>
                </div>
              )}

              {selectedFleet.lastDeployTime && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <Text variant="body-sm" style={{ opacity: 0.7 }}>
                    Last Deploy
                  </Text>
                  <Text variant="body-md">
                    {new Date(selectedFleet.lastDeployTime).toLocaleString()}
                  </Text>
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="Select a Fleet" description="Click on a fleet to view details" />
        )}
      </div>
    </div>
  );
}
