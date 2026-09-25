/**
 * Fleet Inheritance Manager - Type Definitions
 */

export interface Fleet {
  id: string;
  name: string;
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
  source?: {
    type: string;
    location?: string;
  };
}

export interface KnowledgeObject {
  id: string;
  name: string;
  type: string; // parser, breaker, function, job, pipeline, etc.
  description?: string;
  pack?: string;
  source?: string;
  schema?: Record<string, unknown>;
}

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
