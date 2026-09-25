import { Text } from '@capra/core';

export function LoadingState() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <Text variant="body-md">Loading...</Text>
      <div
        style={{
          marginTop: '1rem',
          display: 'inline-block',
          animation: 'spin 1s linear infinite',
        }}
      >
        ⟳
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ padding: '3rem 2rem', textAlign: 'center' }}>
      <Text as="h3" variant="heading-sm">
        {title}
      </Text>
      {description && (
        <Text variant="body-sm" style={{ marginTop: '0.5rem', opacity: 0.7 }}>
          {description}
        </Text>
      )}
    </div>
  );
}

export function SkeletonLoader({ count = 3 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: '1rem',
            marginBottom: '0.5rem',
            backgroundColor: 'var(--ds-background-neutral)',
            borderRadius: '4px',
            animation: 'pulse 2s infinite',
            minHeight: '2rem',
          }}
        />
      ))}
    </div>
  );
}
