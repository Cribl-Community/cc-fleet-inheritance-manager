import React from 'react';
import type { ReactNode } from 'react';
import { Alert, Text } from '@capra/core';
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
        <div className="panel">
          <Alert appearance="danger" title="Something went wrong">
            {this.state.error.message}
          </Alert>
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
    <div className="panel">
      <Alert
        appearance="danger"
        title="Failed to load data"
        action={onRetry ? { label: 'Retry', onClick: () => onRetry() } : undefined}
      >
        {error.message}
      </Alert>
      {error.details ? (
        <div className="error-details">
          <Text variant="body-sm-normal" color="secondary">
            Additional details are available in the browser console.
          </Text>
        </div>
      ) : null}
    </div>
  );
}
