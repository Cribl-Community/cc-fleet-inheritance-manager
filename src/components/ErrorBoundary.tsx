import React, { ReactNode } from 'react';
import { Text } from '@capra/core';
import type { FetchError } from '../types';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: 'var(--ds-text-danger)' }}>
          <Text as="h2" variant="heading">
            Something went wrong
          </Text>
          <Text variant="body-sm">{this.state.error.message}</Text>
        </div>
      );
    }

    return this.props.children;
  }
}

interface ErrorStateProps {
  error: FetchError | null;
  onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  if (!error) return null;

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <Text as="h3" variant="heading-sm">
        Failed to load data
      </Text>
      <Text variant="body-sm" style={{ marginBottom: '1rem' }}>
        {error.message}
      </Text>
      {onRetry && (
        <button onClick={onRetry} style={{ padding: '0.5rem 1rem' }}>
          Retry
        </button>
      )}
    </div>
  );
}
