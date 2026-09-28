/**
 * Fleet Inheritance Manager - Type Definitions
 */

export type FleetProduct = 'stream' | 'edge';

export interface Fleet {
  id: string;
  name: string;
  product: FleetProduct;
  parentId?: string;
  description?: string;
  type?: string;
  deployedVersion?: string;
  lastDeployTime?: number;
  lastConfigTime?: number;
  packs?: Pack[];
}

export interface Pack {
  id: string;
  displayName?: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  dependencies?: string[];
  knowledgeObjects?: KnowledgeObject[];
  groupIds?: string[];
  inheritedFrom?: string;
  inheritedModified?: boolean;
  configDrift?: boolean;
  status?: 'local' | 'inherited' | 'inherited-modified' | 'unknown';
  source?: {
    type: string;
    location?: string;
  };
}

export interface PackUsageLocation {
  fleetId: string;
  fleetName: string;
  product: FleetProduct;
  status?: Pack['status'];
  inheritedFrom?: string;
  parentFleetId?: string;
  configDrift?: boolean;
  version?: string;
}

export interface PackReference {
  packId: string;
  packDisplayName: string;
  exists: boolean;
}

export interface PackRelationshipSummary extends Pack {
  usageLocations: PackUsageLocation[];
  references: PackReference[];
  referencedBy: PackReference[];
}

export interface KnowledgeObject {
  id: string;
  name: string;
  type: string; // parser, breaker, function, job, pipeline, etc.
  description?: string;
  pack?: string;
  source?: string;
  schema?: Record<string, unknown>;
  /** Hash of the definition Cribl returned in the list response, used to compare content across fleets. */
  fingerprint?: string;
}

/** Pack contents read from one fleet, with enough detail to know whether a comparison is trustworthy. */
export interface PackKnowledgeInventory {
  objects: KnowledgeObject[];
  /** Object types that could not be read; the inventory is incomplete when this is non-empty. */
  failedTypes: string[];
  /** Fleet the objects were actually read from, when it is not the fleet itself (for example its parent). */
  readFromGroupId?: string;
  /** Set when nothing could be read for this fleet. */
  error?: string;
}

export interface LookupContentPreview {
  fields: string[];
  rows: Array<Array<string | number>>;
  totalCount: number;
}

export interface PipelineContentPreview {
  definition: Record<string, unknown>;
}

export interface RouteContentPreview {
  id: string;
  name: string;
  description?: string;
  filter?: string;
  pipeline?: string;
  output?: string;
  final?: boolean;
  disabled?: boolean;
  tableId?: string;
  raw: Record<string, unknown>;
}

export type KnowledgeObjectPreview =
  | {
      kind: 'lookup';
      lookup: LookupContentPreview;
    }
  | {
      kind: 'pipeline';
      pipeline: PipelineContentPreview;
    }
  | {
      kind: 'route';
      route: RouteContentPreview;
    };

export interface InheritanceRelation {
  fleet: Fleet;
  pack: Pack;
  inheritedAt?: number;
  status?: 'active' | 'inherited' | 'inherited-modified' | 'disabled';
}

export interface FleetPackRelation {
  fleetId: string;
  packId: string;
  inheritedFrom?: string;
  inheritanceChain?: string[];
}

export interface ApiResponse<T> {
  status: string;
  data?: T;
  items?: T[];
  count?: number;
  warning?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  count: number;
  total?: number;
}

export interface FetchError {
  status: number;
  message: string;
  details?: unknown;
}
