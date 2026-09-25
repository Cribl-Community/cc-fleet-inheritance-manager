import { Text } from '@capra/core';
import { Edge, Stream } from '@capra/icons';
import type { FleetProduct } from '../types';

function getFleetProductPresentation(product: FleetProduct) {
  if (product === 'edge') {
    return {
      Icon: Edge,
      label: 'Edge',
    };
  }

  return {
    Icon: Stream,
    label: 'Stream',
  };
}

export function FleetProductBadge({ product }: { product: FleetProduct }) {
  const { Icon, label } = getFleetProductPresentation(product);

  return (
    <span className="fleet-product-badge">
      <Icon size="sm" />
      <span>{label}</span>
    </span>
  );
}

export function FleetProductInline({ product }: { product: FleetProduct }) {
  const { Icon, label } = getFleetProductPresentation(product);

  return (
    <div className="fleet-product-inline">
      <Icon size="sm" />
      <Text variant="body-sm-normal" color="secondary">
        {label}
      </Text>
    </div>
  );
}
