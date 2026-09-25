import { Spinner, Text } from '@capra/core';

export function LoadingState() {
  return (
    <div className="panel panel-centered">
      <Spinner />
      <div className="panel-copy">
        <Text variant="body-md-normal">Loading…</Text>
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="panel panel-centered">
      <Text as="h3" variant="heading-sm">
        {title}
      </Text>
      {description ? (
        <div className="panel-copy">
          <Text variant="body-sm-normal" color="secondary">
            {description}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

export function SkeletonLoader({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-block" />
      ))}
    </div>
  );
}
