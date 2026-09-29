import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, IconButton, Modal, SelectField, Text } from '@capra/core';
import { ArrowLeft, ArrowRight } from '@capra/icons';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import {
  PackExportAssemblyError,
  commitConfigChanges,
  copyPackLookupFile,
  copyPackIoObjectBetweenGroups,
  copyPackPipelineBetweenGroups,
  copyPackRoutesBetweenGroups,
  describeApiError,
  deployGroup,
  exportPackForEditing,
  fetchGroupPack,
  fetchPendingPackChanges,
  installEditedPack,
  updatePackIoObject,
  updatePackLookupRows,
  updatePackPipeline,
  updatePackRoute,
  type ExportedPackArchive,
  type LookupRowPatch,
  type PackIoType,
  type PendingPackChanges,
} from '../api';
import { nextSharedVersion, type PackMetadataEdits } from '../packArchive';
import type {
  FleetProduct,
  KnowledgeObject,
  Pack,
  PackKnowledgeInventory,
  PackReference,
  PackRelationshipSummary,
  PackUsageLocation,
} from '../types';
import { FleetProductBadge } from './FleetProductBadge';
import {
  useKnowledgeObjectPreview,
  usePackKnowledgeObjectInventories,
  usePackKnowledgeObjects,
  usePackRelationshipSummaries,
} from '../hooks';
import { ErrorState } from './ErrorBoundary';
import { KnowledgeObjectGroups } from './KnowledgeObjectGroups';
import { EmptyState, SkeletonLoader } from './LoadingState';

interface PackDraft {
  displayName: string;
  description: string;
  author: string;
  tags: string;
}

function buildPackDraft(pack: Pack): PackDraft {
  return {
    displayName: pack.displayName ?? pack.id,
    description: pack.description ?? '',
    author: pack.author ?? '',
    tags: pack.tags?.join(', ') ?? '',
  };
}

function parseTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

/** A group whose installed copy of the pack is overwritten on publish. Child fleets inheriting from it are listed with it. */
interface PackPublishTarget {
  groupId: string;
  label: string;
  product?: FleetProduct;
  version?: string;
  inheritingFleets: PackDeployTarget[];
  /** Parent fleet target this fleet inherits the pack from, when the fleet hierarchy shows one. */
  parentGroupId?: string;
  parentLabel?: string;
}

/** A fleet a knowledge-object edit can also be written to. */
interface KnowledgeObjectCopyTarget {
  groupId: string;
  label: string;
  product?: FleetProduct;
  /** Fleets that inherit the pack from this one. */
  inheritedBy: string[];
  /** The fleet's inventory was read and does not contain this object. */
  missing: boolean;
}

/** A fleet a commit is deployed to. */
interface PackDeployTarget {
  groupId: string;
  label: string;
  product?: FleetProduct;
  parentGroupId?: string;
}

function buildDeployTargets(targets: PackPublishTarget[]): PackDeployTarget[] {
  const deployTargets = new Map<string, PackDeployTarget>();

  for (const target of targets) {
    deployTargets.set(target.groupId, {
      groupId: target.groupId,
      label: target.label,
      product: target.product,
      parentGroupId: target.parentGroupId,
    });
  }

  for (const target of targets) {
    for (const child of target.inheritingFleets) {
      if (!deployTargets.has(child.groupId)) {
        deployTargets.set(child.groupId, child);
      }
    }
  }

  // Parents deploy before the child fleets that inherit from them.
  return [...deployTargets.values()].sort((left, right) => Number(Boolean(left.parentGroupId)) - Number(Boolean(right.parentGroupId)));
}

function PublishResultList({ items, label, successLabel }: { items: PackPublishResult[]; label: string; successLabel: string }) {
  return (
    <ul className="publish-results" aria-label={label}>
      {items.map((item) => (
        <li key={item.groupId} className={`publish-result publish-result-${item.tone}`}>
          <Text variant="body-xs-semibold">
            {item.tone === 'success' ? successLabel : item.tone === 'warning' ? 'Check' : 'Failed'}: {item.label}
          </Text>
          <Text variant="body-xs-normal" color="secondary">
            {item.message}
          </Text>
        </li>
      ))}
    </ul>
  );
}

interface PackPublishResult {
  groupId: string;
  label: string;
  tone: 'success' | 'warning' | 'error';
  message: string;
  /** Version this fleet is expected to end up on (installed directly or inherited). */
  expectedVersion?: string;
}

interface FleetTransferOption {
  id: string;
  label: string;
  product?: FleetProduct;
  /** Shown instead of the detail text, and the fleet cannot be moved. */
  disabledReason?: string;
  /** Secondary text for the fleet, depending on whether it is in the chosen list. */
  detail?: (isChosen: boolean) => string;
}

/** Two-list fleet picker: highlight fleets, then move them between Available and the chosen list. */
function FleetTransferList({
  options,
  selectedIds,
  onChange,
  disabled = false,
  chosenTitle,
}: {
  options: FleetTransferOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  chosenTitle: string;
}) {
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const available = options.filter((option) => !selectedIds.includes(option.id));
  const chosen = options.filter((option) => selectedIds.includes(option.id));
  const movable = (option: FleetTransferOption) => !option.disabledReason;
  const highlightedAvailableIds = available.filter(movable).map((option) => option.id).filter((id) => highlightedIds.includes(id));
  const highlightedChosenIds = chosen.map((option) => option.id).filter((id) => highlightedIds.includes(id));
  const move = (ids: string[], direction: 'add' | 'remove') => {
    onChange(
      direction === 'add'
        ? [...selectedIds, ...ids.filter((id) => !selectedIds.includes(id))]
        : selectedIds.filter((id) => !ids.includes(id)),
    );
    setHighlightedIds((current) => current.filter((id) => !ids.includes(id)));
  };
  const renderItem = (option: FleetTransferOption, isChosen: boolean) => {
    const isHighlighted = highlightedIds.includes(option.id);
    const isDisabled = disabled || !movable(option);
    const detail = option.disabledReason ?? option.detail?.(isChosen);

    return (
      <li key={option.id}>
        <button
          type="button"
          className={`fleet-transfer-item${isHighlighted ? ' fleet-transfer-item-highlighted' : ''}`}
          aria-pressed={isHighlighted}
          disabled={isDisabled}
          onClick={() =>
            setHighlightedIds((current) =>
              current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id],
            )
          }
          onDoubleClick={() => move([option.id], isChosen ? 'remove' : 'add')}
        >
          <span className="list-card-header">
            <Text variant="body-sm-semibold">{option.label}</Text>
            {option.product ? <FleetProductBadge product={option.product} /> : null}
          </span>
          {detail ? (
            <Text variant="body-xs-normal" color="secondary">
              {detail}
            </Text>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <>
      <Text variant="body-xs-normal" color="secondary">
        Click fleets to highlight them, then use the arrows to move them. Double-click moves a fleet directly.
      </Text>
      <div className="fleet-transfer">
        <div className="fleet-transfer-list">
          <Text variant="body-xs-semibold" color="secondary">
            Available ({available.length})
          </Text>
          <ul className="fleet-transfer-items" aria-label="Available fleets">
            {available.length > 0 ? (
              available.map((option) => renderItem(option, false))
            ) : (
              <li className="fleet-transfer-empty">
                <Text variant="body-xs-normal" color="secondary">
                  All fleets are selected.
                </Text>
              </li>
            )}
          </ul>
        </div>
        <div className="fleet-transfer-controls">
          <IconButton
            icon={ArrowRight}
            aria-label={`Add ${highlightedAvailableIds.length || ''} highlighted fleet${highlightedAvailableIds.length === 1 ? '' : 's'} to ${chosenTitle}`}
            onClick={() => move(highlightedAvailableIds, 'add')}
            disabled={disabled || highlightedAvailableIds.length === 0}
          />
          <IconButton
            icon={ArrowLeft}
            aria-label={`Remove ${highlightedChosenIds.length || ''} highlighted fleet${highlightedChosenIds.length === 1 ? '' : 's'} from ${chosenTitle}`}
            onClick={() => move(highlightedChosenIds, 'remove')}
            disabled={disabled || highlightedChosenIds.length === 0}
          />
          <button
            type="button"
            className="pill pill-subtle"
            onClick={() => move(available.filter(movable).map((option) => option.id), 'add')}
            disabled={disabled || !available.some(movable)}
          >
            Add all
          </button>
          <button
            type="button"
            className="pill pill-subtle"
            onClick={() => move(selectedIds, 'remove')}
            disabled={disabled || chosen.length === 0}
          >
            Remove all
          </button>
        </div>
        <div className="fleet-transfer-list">
          <Text variant="body-xs-semibold" color="secondary">
            {chosenTitle} ({chosen.length})
          </Text>
          <ul className="fleet-transfer-items" aria-label={chosenTitle}>
            {chosen.length > 0 ? (
              chosen.map((option) => renderItem(option, true))
            ) : (
              <li className="fleet-transfer-empty">
                <Text variant="body-xs-normal" color="secondary">
                  No fleets selected.
                </Text>
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

/** Order an inheritance tree of fleets depth-first (parents before children) and record each fleet's depth. */
function buildFleetTreeOptions(locations: PackUsageLocation[]): Array<{ location: PackUsageLocation; depth: number }> {
  const byFleetId = new Map(locations.map((location) => [location.fleetId, location]));
  const childrenByParent = new Map<string, PackUsageLocation[]>();
  const roots: PackUsageLocation[] = [];

  for (const location of locations) {
    const parentId = location.parentFleetId;

    if (parentId && parentId !== location.fleetId && byFleetId.has(parentId)) {
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), location]);
    } else {
      roots.push(location);
    }
  }

  const byName = (left: PackUsageLocation, right: PackUsageLocation) => left.fleetName.localeCompare(right.fleetName);
  const options: Array<{ location: PackUsageLocation; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (location: PackUsageLocation, depth: number) => {
    if (visited.has(location.fleetId)) {
      return;
    }

    visited.add(location.fleetId);
    options.push({ location, depth });
    [...(childrenByParent.get(location.fleetId) ?? [])].sort(byName).forEach((child) => visit(child, depth + 1));
  };

  [...roots].sort(byName).forEach((root) => visit(root, 0));
  // Fleets caught in a parent cycle have no root; list them at the top level.
  locations.forEach((location) => visit(location, 0));

  return options;
}

function buildPublishTargets(pack: PackRelationshipSummary | null): PackPublishTarget[] {
  if (!pack) {
    return [];
  }

  const targets = new Map<string, PackPublishTarget>();

  for (const location of pack.usageLocations) {
    const groupId = location.inheritedFrom ?? location.fleetId;
    const owner = pack.usageLocations.find((candidate) => candidate.fleetId === groupId);
    const target = targets.get(groupId) ?? {
      groupId,
      label: owner?.fleetName ?? groupId,
      product: owner?.product ?? location.product,
      version: owner?.version ?? location.version,
      inheritingFleets: [],
    };

    if (location.fleetId !== groupId) {
      target.inheritingFleets.push({
        groupId: location.fleetId,
        label: location.fleetName,
        product: location.product,
        parentGroupId: groupId,
      });
    }

    targets.set(groupId, target);
  }

  if (targets.size === 0) {
    for (const groupId of pack.groupIds ?? []) {
      targets.set(groupId, { groupId, label: groupId, version: pack.version, inheritingFleets: [] });
    }
  }

  for (const target of targets.values()) {
    const owner = pack.usageLocations.find((location) => location.fleetId === target.groupId);
    const parentLocation = owner?.parentFleetId
      ? pack.usageLocations.find((location) => location.fleetId === owner.parentFleetId)
      : undefined;
    const parentGroupId = parentLocation ? parentLocation.inheritedFrom ?? parentLocation.fleetId : undefined;

    if (parentGroupId && parentGroupId !== target.groupId && targets.has(parentGroupId)) {
      target.parentGroupId = parentGroupId;
      target.parentLabel = targets.get(parentGroupId)?.label ?? parentGroupId;
    }
  }

  return [...targets.values()].sort((left, right) => left.label.localeCompare(right.label));
}

/** Order targets so parent fleets publish before the child fleets that inherit from them. */
function orderParentsFirst(targets: PackPublishTarget[], allTargets: PackPublishTarget[]): PackPublishTarget[] {
  const byGroupId = new Map(allTargets.map((target) => [target.groupId, target]));
  const depth = (target: PackPublishTarget): number => {
    let level = 0;
    const seen = new Set<string>();
    let parentId = target.parentGroupId;

    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      level += 1;
      parentId = byGroupId.get(parentId)?.parentGroupId;
    }

    return level;
  };

  return [...targets].sort((left, right) => depth(left) - depth(right));
}

function describeSharedVersion(versions: Array<string | undefined>): string {
  try {
    return nextSharedVersion(versions);
  } catch {
    // The exported package.json versions are authoritative; they are checked during publish.
    return 'next version';
  }
}

function knownPackVersions(pack: PackRelationshipSummary | null): Array<string | undefined> {
  return pack ? [pack.version, ...pack.usageLocations.map((location) => location.version)] : [];
}

const KNOWLEDGE_OBJECT_TYPES = ['all', 'lookup', 'pipeline', 'route', 'source', 'destination'] as const;
/** Select value for publishing each fleet's own contents rather than copying one fleet's. */
const OWN_CONTENTS_KEY = '__own-contents__';
type KnowledgeObjectTypeFilter = (typeof KNOWLEDGE_OBJECT_TYPES)[number];
type FleetProductFilter = 'all' | FleetProduct;

type KnowledgeObjectSortMode = 'name-asc' | 'name-desc';

interface InventoryDifference {
  type: KnowledgeObject['type'];
  id: string;
  name: string;
  /** differs: both have it with different content; missing: only the reference has it; extra: only this group has it. */
  kind: 'differs' | 'missing' | 'extra';
}

function formatInventoryDifference(difference: InventoryDifference): string {
  const reason =
    difference.kind === 'extra'
      ? 'only here'
      : difference.kind === 'missing'
        ? 'missing'
        : difference.type === 'lookup'
          ? 'file size differs'
          : 'definition differs';

  return `${difference.type} ${difference.name} (${reason})`;
}

/** Differences the app can fix by copying from the reference fleet (pipelines, route tables, sources, destinations, existing CSV lookups). */
function isCopyableDifference(difference: InventoryDifference): boolean {
  if (difference.kind === 'extra') {
    return false;
  }

  return (
    difference.type === 'pipeline' ||
    difference.type === 'route' ||
    isPackIoType(difference.type) ||
    (difference.type === 'lookup' && difference.kind === 'differs' && /\.csv$/i.test(difference.id))
  );
}

function isPackIoType(type: string): type is PackIoType {
  return type === 'source' || type === 'destination';
}

const PACK_IO_SECRET_NOTE =
  'Passwords, tokens, and keys in sources and destinations are copied exactly as stored; re-enter them in the target fleet if they do not work there.';

interface PackDeploymentGroup {
  key: string;
  versionLabel: string;
  statusLabel: string;
  inheritedFromLabel: string;
  configDriftLabel: string;
  inventoryLabel: string;
  inventorySignature: string;
  /** False when at least one fleet's contents could not be fully read, so the group is not a real comparison. */
  comparable: boolean;
  notes: string[];
  /** How this group's contents differ from the largest comparable group (empty for that group itself). */
  differences: InventoryDifference[];
  objects: KnowledgeObject[];
  usageLocations: PackUsageLocation[];
}

function sortKnowledgeObjectsByName(
  knowledgeObjects: KnowledgeObject[],
  sortMode: KnowledgeObjectSortMode,
): KnowledgeObject[] {
  const next = [...knowledgeObjects];

  next.sort((left, right) => left.name.localeCompare(right.name));

  if (sortMode === 'name-desc') {
    next.reverse();
  }

  return next;
}

/**
 * `classic` keeps edit/publish/deploy controls inline in the details panel.
 * `action-bar` (preview) moves them into a sticky banner and confirms before leaving with pending changes.
 */
export type PacksViewLayout = 'classic' | 'action-bar';

export function PacksView({ layout = 'classic' }: { layout?: PacksViewLayout } = {}) {
  const isActionBarLayout = layout === 'action-bar';
  const { data: packs, loading, error, retry } = usePackRelationshipSummaries();
  const [searchTerm, setSearchTerm] = useState('');
  const [productFilter, setProductFilter] = useState<FleetProductFilter>('all');
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [selectedUsageContextKey, setSelectedUsageContextKey] = useState<string | null>(null);
  const [updatingPackId, setUpdatingPackId] = useState<string | null>(null);
  const [updatePackMessage, setUpdatePackMessage] = useState<string | null>(null);
  const [isEditingPack, setIsEditingPack] = useState(false);
  const [isConfirmingOverwrite, setIsConfirmingOverwrite] = useState(false);
  const [originalConfigGroupIds, setOriginalConfigGroupIds] = useState<string[]>([]);
  const [publishGroupIds, setPublishGroupIds] = useState<string[]>([]);
  /** When set, every selected fleet gets this fleet's pack contents instead of keeping its own. */
  const [publishSourceGroupId, setPublishSourceGroupId] = useState<string | null>(null);
  const [publishResults, setPublishResults] = useState<{ packId: string; items: PackPublishResult[] } | null>(null);
  const [deployPlan, setDeployPlan] = useState<{ packId: string; targets: PackDeployTarget[] } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingPackChanges | null>(null);
  const [isConfirmingDeploy, setIsConfirmingDeploy] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployMessage, setDeployMessage] = useState<{ packId: string; text: string } | null>(null);
  const [deployResults, setDeployResults] = useState<{ packId: string; items: PackPublishResult[] } | null>(null);
  const [packDraft, setPackDraft] = useState<PackDraft | null>(null);
  const [isEditingKnowledgeObject, setIsEditingKnowledgeObject] = useState(false);
  const [savedUncommittedPackIds, setSavedUncommittedPackIds] = useState<string[]>([]);
  const [pendingPackSwitchId, setPendingPackSwitchId] = useState<string | null>(null);
  const [groupSync, setGroupSync] = useState<{
    packId: string;
    groupKey: string;
    confirming: boolean;
    running: boolean;
    message?: string;
    items: PackPublishResult[];
  } | null>(null);

  const filteredPacks = useMemo(() => {
    if (!packs) {
      return [];
    }

    const query = searchTerm.trim().toLowerCase();

    return packs.filter((pack) => {
      const matchesProduct =
        productFilter === 'all' || pack.usageLocations.some((usageLocation) => usageLocation.product === productFilter);

      if (!matchesProduct) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        (pack.displayName ?? '').toLowerCase().includes(query) ||
        (pack.description ?? '').toLowerCase().includes(query) ||
        pack.id.toLowerCase().includes(query) ||
        (pack.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false) ||
        pack.usageLocations.some((usageLocation) => usageLocation.fleetName.toLowerCase().includes(query)) ||
        pack.references.some((reference) => reference.packDisplayName.toLowerCase().includes(query)) ||
        pack.referencedBy.some((reference) => reference.packDisplayName.toLowerCase().includes(query))
      );
    });
  }, [packs, productFilter, searchTerm]);

  const selectedPack = filteredPacks.find((pack) => pack.id === selectedPackId) ?? packs?.find((pack) => pack.id === selectedPackId) ?? null;
  const visibleUsageLocations = useMemo(
    () => filterUsageLocationsByProduct(selectedPack?.usageLocations ?? [], productFilter),
    [productFilter, selectedPack?.usageLocations],
  );
  const selectedUsageLocation = useMemo(
    () =>
      visibleUsageLocations.find(
        (usageLocation) => `${usageLocation.product}:${usageLocation.fleetId}` === selectedUsageContextKey,
      ) ?? null,
    [selectedUsageContextKey, visibleUsageLocations],
  );
  const fleetTreeOptions = useMemo(() => buildFleetTreeOptions(visibleUsageLocations), [visibleUsageLocations]);
  const selectedGroupId = selectedUsageLocation?.fleetId;
  /** The pack is deployed to fleets but the user has not picked which one to view yet. */
  const needsFleetSelection = visibleUsageLocations.length > 0 && !selectedUsageLocation;
  const fleetScopedPackId = needsFleetSelection ? null : selectedPackId;
  const selectedPackGroupId = selectedUsageLocation?.inheritedFrom ?? selectedGroupId ?? selectedPack?.groupIds?.[0];
  const publishTargets = useMemo(() => buildPublishTargets(selectedPack), [selectedPack]);
  const plannedVersion = useMemo(() => describeSharedVersion(knownPackVersions(selectedPack)), [selectedPack]);
  const {
    data: knowledgeObjects,
    loading: koLoading,
    error: knowledgeError,
    retry: retryKnowledge,
  } = usePackKnowledgeObjects(fleetScopedPackId, selectedGroupId);
  const [selectedKnowledgeObject, setSelectedKnowledgeObject] = useState<KnowledgeObject | null>(null);
  const [knowledgeObjectTypeFilter, setKnowledgeObjectTypeFilter] = useState<KnowledgeObjectTypeFilter>('all');
  const [knowledgeObjectSortMode, setKnowledgeObjectSortMode] = useState<KnowledgeObjectSortMode>('name-asc');
  const {
    data: preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview,
  } = useKnowledgeObjectPreview(fleetScopedPackId, selectedKnowledgeObject, selectedGroupId);

  const summaryFleetCount = useMemo(() => {
    const fleetKeys = new Set<string>();
    filteredPacks.forEach((pack) => {
      filterUsageLocationsByProduct(pack.usageLocations, productFilter).forEach((usageLocation) => {
        fleetKeys.add(`${usageLocation.product}:${usageLocation.fleetId}`);
      });
    });
    return fleetKeys.size;
  }, [filteredPacks, productFilter]);

  const summaryReferenceCount = useMemo(() => {
    const referenceKeys = new Set<string>();
    filteredPacks.forEach((pack) => {
      pack.references.forEach((reference) => referenceKeys.add(reference.packId.toLowerCase()));
    });
    return referenceKeys.size;
  }, [filteredPacks]);

  const {
    data: packKnowledgeInventories,
    loading: inventoriesLoading,
    error: inventoriesError,
    retry: retryInventories,
  } = usePackKnowledgeObjectInventories(selectedPackId, visibleUsageLocations);

  const visibleDeploymentGroups = useMemo(
    () => buildPackDeploymentGroups(visibleUsageLocations, packKnowledgeInventories),
    [packKnowledgeInventories, visibleUsageLocations],
  );
  const comparableGroupCount = visibleDeploymentGroups.filter((group) => group.comparable).length;
  const notComparedFleetCount = visibleDeploymentGroups
    .filter((group) => !group.comparable)
    .reduce((count, group) => count + group.usageLocations.length, 0);

  const visibleKnowledgeObjects = useMemo(() => {
    if (!knowledgeObjects) {
      return [];
    }

    const filtered = knowledgeObjectTypeFilter === 'all'
      ? knowledgeObjects
      : knowledgeObjects.filter((knowledgeObject) => knowledgeObject.type === knowledgeObjectTypeFilter);

    return sortKnowledgeObjectsByName(filtered, knowledgeObjectSortMode);
  }, [knowledgeObjectSortMode, knowledgeObjectTypeFilter, knowledgeObjects]);

  useEffect(() => {
    setSelectedKnowledgeObject(null);
  }, [selectedGroupId, selectedPackId]);

  useEffect(() => {
    if (filteredPacks.length === 0) {
      setSelectedPackId(null);
      return;
    }

    if (!selectedPackId || !filteredPacks.some((pack) => pack.id === selectedPackId)) {
      setSelectedPackId(filteredPacks[0]?.id ?? null);
    }
  }, [filteredPacks, selectedPackId]);

  useEffect(() => {
    if (!selectedPack) {
      setPackDraft(null);
      setIsEditingPack(false);
      setSelectedUsageContextKey(null);
      return;
    }

    setPackDraft(buildPackDraft(selectedPack));
    setIsEditingPack(false);
    setIsConfirmingOverwrite(false);
    setOriginalConfigGroupIds([]);
    setPublishGroupIds([]);
    setPublishSourceGroupId(null);
    setIsConfirmingDeploy(false);
    setPendingChanges(null);

    // Never pick a fleet on the user's behalf; only drop a selection that no longer applies.
    const currentKey = selectedUsageContextKey;
    if (
      currentKey &&
      !visibleUsageLocations.some((usageLocation) => `${usageLocation.product}:${usageLocation.fleetId}` === currentKey)
    ) {
      setSelectedUsageContextKey(null);
    }
  }, [selectedPack, selectedUsageContextKey, visibleUsageLocations]);

  useEffect(() => {
    // Each pack click starts with no fleet chosen so the user always picks the one they are looking at.
    setSelectedUsageContextKey(null);
  }, [selectedPackId]);

  const packEdits = useMemo((): PackMetadataEdits => {
    if (!selectedPack || !packDraft) {
      return {};
    }

    const original = buildPackDraft(selectedPack);
    const edits: PackMetadataEdits = {};

    if (packDraft.displayName !== original.displayName) {
      edits.displayName = packDraft.displayName.trim();
    }
    if (packDraft.description !== original.description) {
      edits.description = packDraft.description;
    }
    if (packDraft.author !== original.author) {
      edits.author = packDraft.author.trim();
    }
    if (parseTags(packDraft.tags).join(',') !== parseTags(original.tags).join(',')) {
      edits.tags = parseTags(packDraft.tags);
    }

    return edits;
  }, [packDraft, selectedPack]);

  const handlePackDraftChange = useCallback((field: keyof PackDraft, value: string) => {
    setPackDraft((current) => (current ? { ...current, [field]: value } : current));
    setIsConfirmingOverwrite(false);
  }, []);

  const setPublishTargetSelection = useCallback((groupIds: string[]) => {
    setPublishGroupIds(groupIds);
    setIsConfirmingOverwrite(false);
  }, []);

  const handlePublishPack = useCallback(async () => {
    if (!selectedPack || !packDraft) {
      setUpdatePackMessage('No pack is selected, so publish cannot start.');
      return;
    }

    const changedFields = Object.keys(packEdits);
    const packLabel = selectedPack.displayName ?? selectedPack.id;
    const sourceTarget = publishSourceGroupId
      ? publishTargets.find((target) => target.groupId === publishSourceGroupId)
      : undefined;

    if (changedFields.length === 0 && !sourceTarget) {
      setUpdatePackMessage('No changes to publish. Edit a field first, or choose a fleet to copy the pack contents from.');
      return;
    }

    const selectedIds = sourceTarget ? [...new Set([sourceTarget.groupId, ...publishGroupIds])] : publishGroupIds;
    const targets = orderParentsFirst(
      publishTargets.filter((target) => selectedIds.includes(target.groupId)),
      publishTargets,
    );

    if (targets.length === 0 || (sourceTarget && targets.length === 1 && changedFields.length === 0)) {
      setUpdatePackMessage(sourceTarget ? 'Select at least one fleet to copy the contents to.' : 'Select at least one fleet to update.');
      return;
    }

    if (!isConfirmingOverwrite) {
      const targetSummary = targets.map((target) => `${target.label} (${target.version ?? 'unknown'})`).join('; ');
      const discardsLocalChanges = targets.some((target) => originalConfigGroupIds.includes(target.groupId));
      const childrenWithoutParent = targets.filter(
        (target) => target.parentGroupId && !selectedIds.includes(target.parentGroupId),
      );
      const crossProductTargets = sourceTarget
        ? targets.filter((target) => target.product && sourceTarget.product && target.product !== sourceTarget.product)
        : [];

      setIsConfirmingOverwrite(true);
      setUpdatePackMessage(
        `This will replace "${packLabel}" in ${targets.length} fleet${targets.length === 1 ? '' : 's'} (${targetSummary}) and set all of them to version ${plannedVersion}, the next version after the latest one any fleet reports. ` +
          `${changedFields.length > 0 ? `Changing: ${changedFields.join(', ')}. ` : ''}` +
          `${sourceTarget ? `Every other fleet's pack contents (pipelines, routes, lookups, sources, destinations, and any local modifications) are discarded and replaced with a copy of ${sourceTarget.label}'s contents. ` : ''}` +
          `${crossProductTargets.length > 0 ? `${crossProductTargets.map((target) => target.label).join(', ')} ${crossProductTargets.length === 1 ? 'is' : 'are'} a different product than ${sourceTarget?.label} and will be skipped. ` : ''}` +
          `${discardsLocalChanges ? 'Fleets marked "original configuration" will lose local modifications to this pack. ' : ''}` +
          `${childrenWithoutParent.length > 0 ? `${childrenWithoutParent.map((target) => `${target.label} inherits from ${target.parentLabel}`).join('; ')}, so if it has no copy of its own it is only updated by also selecting its parent. ` : ''}` +
          'This cannot be undone. Click Confirm overwrite to continue.',
      );
      return;
    }

    setIsConfirmingOverwrite(false);
    setUpdatingPackId(selectedPack.id);

    const items: PackPublishResult[] = [];
    const needsOriginalConfig: string[] = [];
    const exportedByGroup = new Map<string, ExportedPackArchive>();
    /** Fleets whose pack is reinstalled over (force) with the source fleet's contents rather than upgraded. */
    const replaceGroupIds = new Set<string>();
    const probedVersions: Array<string | undefined> = [];
    const inheritingTargets: PackPublishTarget[] = [];
    const progress = (target: PackPublishTarget, step: string) =>
      setUpdatePackMessage(`[${targets.indexOf(target) + 1}/${targets.length}] ${target.label}: ${step}`);
    const fail = (target: PackPublishTarget, message: string) =>
      items.push({ groupId: target.groupId, label: target.label, tone: 'error', message });
    const originalConfigHint =
      'You can publish this fleet from the original pack configuration instead, but that discards its local modifications to this pack. Click Publish again to review that option.';

    if (sourceTarget) {
      // Phase 1 (copy mode): export the source once; other fleets are only checked for a copy of their own.
      let sourceArchive: ExportedPackArchive | undefined;

      try {
        sourceArchive = await exportPackForEditing(selectedPack.id, {
          groupId: sourceTarget.groupId,
          allowOriginalConfigExport: originalConfigGroupIds.includes(sourceTarget.groupId),
          onProgress: (step) => progress(sourceTarget, step),
        });
      } catch (error) {
        let reason = error instanceof Error ? error.message : 'Export failed.';

        if (error instanceof PackExportAssemblyError && sourceTarget.parentGroupId) {
          reason = `${sourceTarget.label} has no copy of the pack of its own to copy from; it inherits it from ${sourceTarget.parentLabel}. Choose ${sourceTarget.parentLabel} as the source instead.`;
        } else if (error instanceof PackExportAssemblyError) {
          needsOriginalConfig.push(sourceTarget.groupId);
          reason = `${error.message} ${originalConfigHint}`;
        }

        for (const target of targets) {
          fail(target, target === sourceTarget ? reason : `Not changed, because the contents of ${sourceTarget.label} could not be exported.`);
        }
      }

      if (sourceArchive) {
        exportedByGroup.set(sourceTarget.groupId, sourceArchive);

        for (const target of targets) {
          if (target === sourceTarget) {
            continue;
          }

          if (target.product && sourceTarget.product && target.product !== sourceTarget.product) {
            fail(target, `Skipped: packs cannot be copied between ${sourceTarget.product} and ${target.product} fleets.`);
            continue;
          }

          if (target.parentGroupId) {
            try {
              const own = await exportPackForEditing(selectedPack.id, {
                groupId: target.groupId,
                onProgress: () => progress(target, 'Checking whether this fleet has its own copy of the pack…'),
              });
              probedVersions.push(own.version);
            } catch (error) {
              if (error instanceof PackExportAssemblyError) {
                inheritingTargets.push(target);
              } else {
                fail(target, error instanceof Error ? error.message : 'Could not check this fleet.');
              }
              continue;
            }
          }

          exportedByGroup.set(target.groupId, sourceArchive);
          replaceGroupIds.add(target.groupId);
        }
      }
    } else {
      // Phase 1: export every selected fleet, so the new version can be chosen from what Cribl actually has installed.
      for (const target of targets) {
        try {
          exportedByGroup.set(
            target.groupId,
            await exportPackForEditing(selectedPack.id, {
              groupId: target.groupId,
              allowOriginalConfigExport: originalConfigGroupIds.includes(target.groupId),
              onProgress: (step) => progress(target, step),
            }),
          );
        } catch (error) {
          if (error instanceof PackExportAssemblyError && target.parentGroupId) {
            // No standalone copy of the pack in this fleet to export; it inherits the pack from its parent.
            inheritingTargets.push(target);
          } else if (error instanceof PackExportAssemblyError) {
            needsOriginalConfig.push(target.groupId);
            fail(target, `${error.message} ${originalConfigHint}`);
          } else {
            fail(target, error instanceof Error ? error.message : 'Export failed.');
          }
        }
      }
    }

    // Phase 2: one shared version for every fleet, the next after the latest version known anywhere.
    let sharedVersion: string | undefined;
    try {
      sharedVersion = nextSharedVersion([
        ...knownPackVersions(selectedPack),
        ...[...exportedByGroup.values()].map((exported) => exported.version),
        ...probedVersions,
      ]);
    } catch (error) {
      for (const target of targets) {
        if (exportedByGroup.has(target.groupId)) {
          fail(target, error instanceof Error ? error.message : 'Could not choose a version.');
        }
      }
      exportedByGroup.clear();
    }

    // Phase 3: install that version in each exported fleet, parents first.
    for (const target of targets) {
      const exported = exportedByGroup.get(target.groupId);

      if (!exported || !sharedVersion) {
        continue;
      }

      try {
        const replaced = replaceGroupIds.has(target.groupId);
        const result = await installEditedPack(selectedPack.id, exported, packEdits, {
          groupId: target.groupId,
          version: sharedVersion,
          replaceExisting: replaced,
          onProgress: (step) => progress(target, step),
        });
        const installedVersion = result.pack.version;
        const copyNote = replaced && sourceTarget ? `Contents replaced with a copy of ${sourceTarget.label}.` : '';

        items.push(
          installedVersion === sharedVersion
            ? {
                groupId: target.groupId,
                label: target.label,
                tone: 'success',
                message: [
                  `Cribl now reports version ${installedVersion} (was ${replaced ? target.version ?? 'unknown' : result.previousVersion}).`,
                  copyNote,
                  ...result.warnings,
                ].filter(Boolean).join(' '),
                expectedVersion: sharedVersion,
              }
            : {
                groupId: target.groupId,
                label: target.label,
                tone: 'warning',
                message: `Upload finished, but Cribl reports version ${installedVersion ?? 'unknown'} instead of ${sharedVersion}. Check the pack in Cribl before relying on this change.`,
              },
        );
      } catch (error) {
        fail(target, error instanceof Error ? error.message : 'Publish failed.');
      }

      setPublishResults({ packId: selectedPack.id, items: [...items] });
    }

    // Phase 4: fleets that inherit the pack are updated through their parent.
    for (const target of inheritingTargets) {
      const parentLabel = target.parentLabel ?? target.parentGroupId;
      const parentResult = items.find((item) => item.groupId === target.parentGroupId && item.expectedVersion);
      let currentVersion: string | undefined;

      try {
        progress(target, `Checking the version inherited from ${parentLabel}…`);
        currentVersion = (await fetchGroupPack(selectedPack.id, target.groupId)).version;
      } catch {
        currentVersion = undefined;
      }

      if (!parentResult) {
        fail(
          target,
          `This fleet has no copy of the pack of its own to overwrite; it inherits it from ${parentLabel} (currently version ${currentVersion ?? 'unknown'}). Select ${parentLabel} as well to update it.`,
        );
      } else if (currentVersion === parentResult.expectedVersion) {
        items.push({
          groupId: target.groupId,
          label: target.label,
          tone: 'success',
          message: `Updated through inheritance from ${parentLabel}: this fleet now reports version ${currentVersion}.`,
          expectedVersion: currentVersion,
        });
      } else {
        items.push({
          groupId: target.groupId,
          label: target.label,
          tone: 'warning',
          message: `This fleet inherits the pack from ${parentLabel} and still reports version ${currentVersion ?? 'unknown'}. It should pick up version ${parentResult.expectedVersion} after Commit & deploy.`,
          expectedVersion: parentResult.expectedVersion,
        });
      }
    }

    items.sort((left, right) => targets.findIndex((t) => t.groupId === left.groupId) - targets.findIndex((t) => t.groupId === right.groupId));
    setPublishResults({ packId: selectedPack.id, items: [...items] });

    const failedGroupIds = items.filter((item) => item.tone === 'error').map((item) => item.groupId);
    const publishedCount = items.length - failedGroupIds.length;
    const publishedTargets = publishTargets.filter((target) =>
      items.some((item) => item.groupId === target.groupId && item.tone !== 'error'),
    );

    if (publishedTargets.length > 0) {
      setDeployPlan({ packId: selectedPack.id, targets: buildDeployTargets(publishedTargets) });
      setDeployResults(null);
      setDeployMessage({
        packId: selectedPack.id,
        text: 'The new version is installed on the Leader but not live on the fleets yet. Use Commit & deploy below to roll it out.',
      });
    }

    setUpdatingPackId(null);
    setUpdatePackMessage(
      failedGroupIds.length === 0
        ? `Published "${packLabel}" to ${publishedCount} of ${targets.length} fleet${targets.length === 1 ? '' : 's'}.`
        : `Published "${packLabel}" to ${publishedCount} of ${targets.length} fleets. The failed fleets are still selected so you can retry them.`,
    );

    if (failedGroupIds.length === 0) {
      setOriginalConfigGroupIds([]);
      setPublishSourceGroupId(null);
      setIsEditingPack(false);
      retry();
    } else {
      setPublishGroupIds(failedGroupIds);
      setOriginalConfigGroupIds((current) =>
        [...new Set([...current, ...needsOriginalConfig])].filter((groupId) => failedGroupIds.includes(groupId)),
      );
    }
  }, [isConfirmingOverwrite, originalConfigGroupIds, packDraft, packEdits, plannedVersion, publishGroupIds, publishSourceGroupId, publishTargets, retry, selectedPack]);

  const deployTargets = useMemo(
    () =>
      selectedPack && deployPlan?.packId === selectedPack.id ? deployPlan.targets : buildDeployTargets(publishTargets),
    [deployPlan, publishTargets, selectedPack],
  );

  const handleCommitAndDeploy = useCallback(async () => {
    if (!selectedPack) {
      return;
    }

    const packId = selectedPack.id;
    const packLabel = selectedPack.displayName ?? packId;
    const fleetLabels = deployTargets.map((target) => target.label).join(', ');
    const report = (text: string) => setDeployMessage({ packId, text });

    if (deployTargets.length === 0) {
      report('No fleets with this pack were found to deploy to.');
      return;
    }

    if (!isConfirmingDeploy || !pendingChanges) {
      setIsDeploying(true);
      setDeployResults(null);
      report('Checking uncommitted changes for this pack…');

      try {
        const pending = await fetchPendingPackChanges(packId, deployTargets.map((target) => target.groupId));

        if (pending.conflictedFiles.length > 0) {
          report(`These pack files have merge conflicts and must be resolved in Cribl before committing: ${pending.conflictedFiles.join(', ')}.`);
          return;
        }

        if (pending.packFiles.length === 0) {
          report(`No uncommitted changes for "${packLabel}" were found in ${fleetLabels}, so there is nothing to commit.`);
          return;
        }

        setPendingChanges(pending);
        setCommitMessage(`Update pack ${packId} (Fleet Inheritance Manager)`);
        setIsConfirmingDeploy(true);
        report(
          `This will commit the ${pending.packFiles.length} file${pending.packFiles.length === 1 ? '' : 's'} listed below for "${packLabel}" and deploy that commit to: ${fleetLabels}. ` +
            `${pending.otherFiles.length > 0 ? `${pending.otherFiles.length} other uncommitted file${pending.otherFiles.length === 1 ? ' is' : 's are'} in these fleets and will be left out of the commit. ` : ''}` +
            'Deploying also rolls out anything else already committed for these fleets. This cannot be undone. Review the commit message, then click Confirm commit & deploy to continue.',
        );
      } catch (error) {
        report(`Could not read uncommitted changes: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsDeploying(false);
      }

      return;
    }

    const message = commitMessage.trim();

    if (!message) {
      report('Enter a commit message before confirming.');
      return;
    }

    setIsConfirmingDeploy(false);
    setIsDeploying(true);

    let commit: string;
    try {
      report(`Committing ${pendingChanges.packFiles.length} file${pendingChanges.packFiles.length === 1 ? '' : 's'}…`);
      commit = await commitConfigChanges(message, pendingChanges.packFiles);
    } catch (error) {
      report(`Commit failed, so nothing was deployed: ${error instanceof Error ? error.message : String(error)}`);
      setPendingChanges(null);
      setIsDeploying(false);
      return;
    }

    const shortCommit = commit.slice(0, 7);
    const deployed: Array<{ target: PackDeployTarget; configVersion?: string }> = [];
    const items: PackPublishResult[] = [];

    for (const [index, target] of deployTargets.entries()) {
      report(`[${index + 1}/${deployTargets.length}] Deploying commit ${shortCommit} to ${target.label}…`);

      try {
        deployed.push({ target, configVersion: await deployGroup(target.groupId, commit, target.product) });
      } catch (error) {
        items.push({
          groupId: target.groupId,
          label: target.label,
          tone: 'error',
          message: `Deploy failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    report('Checking the pack version each fleet reports…');
    const reportedVersions = new Map<string, string | undefined>();

    for (const { target } of deployed) {
      try {
        reportedVersions.set(target.groupId, (await fetchGroupPack(packId, target.groupId)).version);
      } catch {
        reportedVersions.set(target.groupId, undefined);
      }
    }

    for (const { target, configVersion } of deployed) {
      const packVersion = reportedVersions.get(target.groupId);
      const parentVersion = target.parentGroupId ? reportedVersions.get(target.parentGroupId) : undefined;
      const commitMatches = !configVersion || commit.startsWith(configVersion) || configVersion.startsWith(commit);
      const inheritanceMatches = !target.parentGroupId || !parentVersion || packVersion === parentVersion;
      const versionText = `reports pack version ${packVersion ?? 'unknown'}`;

      items.push(
        commitMatches && inheritanceMatches
          ? {
              groupId: target.groupId,
              label: target.label,
              tone: 'success',
              message: `Deployed commit ${shortCommit}; this fleet ${versionText}.`,
            }
          : {
              groupId: target.groupId,
              label: target.label,
              tone: 'warning',
              message: !commitMatches
                ? `Deploy was accepted, but Cribl reports config version ${configVersion} instead of ${shortCommit}; this fleet ${versionText}.`
                : `Deployed commit ${shortCommit}, but this fleet ${versionText} while its parent reports ${parentVersion}. Reload in a moment to re-check.`,
            },
      );
    }

    const failedCount = items.filter((item) => item.tone === 'error').length;
    setDeployResults({ packId, items });
    report(
      `Committed ${shortCommit} and deployed to ${deployTargets.length - failedCount} of ${deployTargets.length} fleet${deployTargets.length === 1 ? '' : 's'}.`,
    );
    setPendingChanges(null);
    setIsDeploying(false);

    if (failedCount === 0) {
      setDeployPlan(null);
      setSavedUncommittedPackIds((current) => current.filter((id) => id !== packId));
    }

    retry();
  }, [commitMessage, deployTargets, isConfirmingDeploy, pendingChanges, retry, selectedPack]);

  const handleToggleEdit = useCallback(() => {
    if (!selectedPack) {
      return;
    }

    if (isEditingPack) {
      setPackDraft(buildPackDraft(selectedPack));
      setUpdatePackMessage(null);
      setOriginalConfigGroupIds([]);
      setPublishGroupIds([]);
      setPublishSourceGroupId(null);
    } else {
      const defaultTarget = publishTargets.find((target) => target.groupId === selectedPackGroupId) ?? publishTargets[0];
      setPublishGroupIds(defaultTarget ? [defaultTarget.groupId] : []);
      setPublishResults(null);
    }
    setIsEditingPack((current) => !current);
    setIsConfirmingOverwrite(false);
  }, [isEditingPack, publishTargets, selectedPack, selectedPackGroupId]);

  const handleCancelDeploy = useCallback(() => {
    if (!selectedPack) {
      return;
    }

    setIsConfirmingDeploy(false);
    setPendingChanges(null);
    setDeployMessage({ packId: selectedPack.id, text: 'Commit & deploy cancelled. Nothing was changed.' });
  }, [selectedPack]);

  const handleKnowledgeObjectSaved = useCallback(() => {
    if (selectedPack) {
      const packId = selectedPack.id;
      setSavedUncommittedPackIds((current) => (current.includes(packId) ? current : [...current, packId]));
    }
    retryInventories();
  }, [retryInventories, selectedPack]);

  /** The first fleet of the largest content-identical group; other groups are made identical to it. */
  const referenceFleet = visibleDeploymentGroups.find((group) => group.comparable)?.usageLocations[0] ?? null;
  const isGroupSyncRunning = Boolean(groupSync?.running);

  const handleCancelGroupSync = useCallback(() => {
    setGroupSync((current) =>
      current ? { ...current, confirming: false, message: 'Cancelled. Nothing was changed.' } : current,
    );
  }, []);

  const handleSyncGroup = useCallback(async (group: PackDeploymentGroup) => {
    if (!selectedPack || !referenceFleet) {
      return;
    }

    const packId = selectedPack.id;
    const referenceInventory = packKnowledgeInventories?.get(`${referenceFleet.product}:${referenceFleet.fleetId}`);
    const sourceGroupId = referenceInventory?.readFromGroupId ?? referenceFleet.fleetId;
    const copyable = group.differences.filter(isCopyableDifference);
    const notCopied = group.differences.filter((difference) => !isCopyableDifference(difference));
    const pipelines = copyable.filter((difference) => difference.type === 'pipeline');
    const lookups = copyable.filter((difference) => difference.type === 'lookup');
    const copyRoutes = copyable.some((difference) => difference.type === 'route');
    const ioObjects = copyable.filter((difference) => isPackIoType(difference.type));
    const fleetNames = group.usageLocations.map((location) => location.fleetName).join(', ');

    if (!(groupSync?.packId === packId && groupSync.groupKey === group.key && groupSync.confirming)) {
      setGroupSync({
        packId,
        groupKey: group.key,
        confirming: true,
        running: false,
        items: [],
        message:
          `This overwrites the following in ${fleetNames} with the copies from ${referenceFleet.fleetName}: ` +
          `${[
            ...pipelines.map((difference) => `pipeline ${difference.name}${difference.kind === 'missing' ? ' (added)' : ''}`),
            ...(copyRoutes ? ['the whole routing table'] : []),
            ...lookups.map((difference) => `lookup ${difference.name} (whole file)`),
            ...ioObjects.map((difference) => `${difference.type} ${difference.name}${difference.kind === 'missing' ? ' (added)' : ''}`),
          ].join(', ')}. ` +
          `${notCopied.length > 0 ? `Not changed: ${notCopied.map(formatInventoryDifference).join(', ')}. ` : ''}` +
          `${ioObjects.length > 0 ? `${PACK_IO_SECRET_NOTE} ` : ''}` +
          'This cannot be undone. Click Confirm overwrite to continue.',
      });
      return;
    }

    setGroupSync({ packId, groupKey: group.key, confirming: false, running: true, items: [], message: `Copying from ${referenceFleet.fleetName}…` });

    const items: PackPublishResult[] = [];

    for (const location of group.usageLocations) {
      const targetGroupId = location.fleetId;
      const done: string[] = [];
      const failed: string[] = [];
      const attempt = async (label: string, action: () => Promise<void>) => {
        try {
          await action();
          done.push(label);
        } catch (error) {
          failed.push(`${label}: ${describeApiError(error)}`);
        }
      };

      for (const difference of pipelines) {
        await attempt(`pipeline ${difference.name}`, () =>
          copyPackPipelineBetweenGroups(packId, difference.id, sourceGroupId, targetGroupId, difference.kind === 'differs'),
        );
      }
      if (copyRoutes) {
        await attempt('routing table', () => copyPackRoutesBetweenGroups(packId, sourceGroupId, targetGroupId));
      }
      for (const difference of lookups) {
        await attempt(`lookup ${difference.name}`, () =>
          copyPackLookupFile(packId, difference.id, sourceGroupId, targetGroupId),
        );
      }
      for (const difference of ioObjects) {
        await attempt(`${difference.type} ${difference.name}`, () =>
          copyPackIoObjectBetweenGroups(
            packId,
            difference.type as PackIoType,
            difference.id,
            sourceGroupId,
            targetGroupId,
            difference.kind === 'differs',
          ),
        );
      }

      items.push({
        groupId: targetGroupId,
        label: location.fleetName,
        tone: failed.length === 0 ? 'success' : done.length > 0 ? 'warning' : 'error',
        message: [
          done.length > 0 ? `Copied ${done.join(', ')} from ${referenceFleet.fleetName}.` : '',
          failed.length > 0 ? `Failed: ${failed.join('; ')}` : '',
        ].filter(Boolean).join(' '),
      });
    }

    const anyCopied = items.some((item) => item.tone !== 'error');
    setGroupSync({
      packId,
      groupKey: group.key,
      confirming: false,
      running: false,
      items,
      message: anyCopied
        ? 'Saved on the Leader. Use Commit & deploy to roll the changes out to the fleets. The groups below refresh to show the result.'
        : 'Nothing was copied.',
    });

    if (anyCopied) {
      handleKnowledgeObjectSaved();
    }
  }, [groupSync, handleKnowledgeObjectSaved, packKnowledgeInventories, referenceFleet, selectedPack]);

  const buildCopyTargets = (knowledgeObject: KnowledgeObject): KnowledgeObjectCopyTarget[] =>
    publishTargets
      .filter((target) => target.groupId !== selectedGroupId)
      .map((target) => {
        const inventory = packKnowledgeInventories?.get(`${target.product ?? 'stream'}:${target.groupId}`);
        const complete = inventory !== undefined && !describeInventoryGap(inventory);

        return {
          groupId: target.groupId,
          label: target.label,
          product: target.product,
          inheritedBy: target.inheritingFleets.map((child) => child.label),
          missing:
            complete &&
            !inventory.objects.some((candidate) => candidate.type === knowledgeObject.type && candidate.id === knowledgeObject.id),
        };
      });

  // Pending-change tracking for the action-bar layout's leave-page confirmation.
  const changedFieldCount = Object.keys(packEdits).length;
  const isBusy = updatingPackId !== null || isDeploying;
  const hasUnsavedDraft = (isEditingPack && changedFieldCount > 0) || isEditingKnowledgeObject;
  const unsavedDraftReasons = [
    ...(isEditingPack && changedFieldCount > 0
      ? [`${changedFieldCount} unsaved pack metadata change${changedFieldCount === 1 ? '' : 's'}`]
      : []),
    ...(isEditingKnowledgeObject ? ['A knowledge object edit that has not been saved'] : []),
  ];
  const pendingReasons = [
    ...unsavedDraftReasons,
    ...(deployPlan ? [`Published changes to "${deployPlan.packId}" that are not committed and deployed yet`] : []),
    ...savedUncommittedPackIds.map((id) => `Saved knowledge object edits in "${id}" that are not committed and deployed yet`),
    ...(isBusy ? ['A publish or deploy operation that is still running'] : []),
  ];
  const shouldGuardNavigation = isActionBarLayout && pendingReasons.length > 0;

  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) => shouldGuardNavigation && currentLocation.pathname !== nextLocation.pathname,
      [shouldGuardNavigation],
    ),
  );

  useEffect(() => {
    if (!shouldGuardNavigation) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldGuardNavigation]);

  const requestPackSelection = useCallback(
    (packId: string) => {
      if (isActionBarLayout && packId !== selectedPackId && hasUnsavedDraft) {
        setPendingPackSwitchId(packId);
        return;
      }

      setSelectedPackId(packId);
    },
    [hasUnsavedDraft, isActionBarLayout, selectedPackId],
  );

  const isLeaveModalOpen = blocker.state === 'blocked' || pendingPackSwitchId !== null;

  const confirmLeave = () => {
    if (blocker.state === 'blocked') {
      blocker.proceed();
    }
    if (pendingPackSwitchId) {
      setSelectedPackId(pendingPackSwitchId);
      setPendingPackSwitchId(null);
    }
  };

  const cancelLeave = () => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
    setPendingPackSwitchId(null);
  };

  useEffect(() => {
    if (
      selectedKnowledgeObject &&
      !visibleKnowledgeObjects.some(
        (knowledgeObject) =>
          knowledgeObject.type === selectedKnowledgeObject.type &&
          knowledgeObject.id === selectedKnowledgeObject.id,
      )
    ) {
      setSelectedKnowledgeObject(null);
    }
  }, [selectedKnowledgeObject, visibleKnowledgeObjects]);

  if (loading) {
    return <SkeletonLoader count={5} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={retry} />;
  }

  if (!packs || packs.length === 0) {
    return (
      <EmptyState
        title="No packs found"
        description="No packs are currently visible for this Cribl environment."
      />
    );
  }

  const isPackBusy = selectedPack ? updatingPackId === selectedPack.id : false;
  const publishSource = publishSourceGroupId
    ? publishTargets.find((target) => target.groupId === publishSourceGroupId)
    : undefined;

  const publishTransferOptions: FleetTransferOption[] = publishTargets.map((target) => ({
    id: target.groupId,
    label: target.label,
    product: target.product,
    detail: (isChosen) =>
      [
        isChosen
          ? `${target.version ?? 'Unknown version'} → ${target.parentGroupId ? `${plannedVersion} (via ${target.parentLabel})` : plannedVersion}`
          : target.version ?? 'Unknown version',
        isChosen && target.inheritingFleets.length > 0
          ? `Also inherited by: ${target.inheritingFleets.map((child) => child.label).join(', ')}`
          : '',
        target.parentLabel ? `Inherits from ${target.parentLabel}` : '',
        isChosen && originalConfigGroupIds.includes(target.groupId)
          ? 'Will publish from original configuration (local modifications discarded)'
          : '',
        isChosen && publishSource
          ? target.groupId === publishSource.groupId
            ? 'Source of the contents'
            : `Contents replaced with a copy of ${publishSource.label}`
          : '',
      ].filter(Boolean).join(' · '),
  }));

  const editForm = selectedPack && isEditingPack && packDraft ? (
    <div className="detail-section" style={{ marginTop: '1rem' }}>
      <Text as="h3" variant="heading-sm">
        Edit pack metadata
      </Text>
      <div className="metadata-grid" style={{ marginTop: '0.75rem' }}>
        {publishTargets.length > 1 ? (
          <div className="metadata-row" style={{ gridColumn: '1 / -1' }}>
            <SelectField
              label="Pack contents"
              size="sm"
              value={publishSourceGroupId ?? OWN_CONTENTS_KEY}
              disabled={isPackBusy}
              onChange={(key) => {
                const groupId = key === null || key === OWN_CONTENTS_KEY ? null : String(key);
                setPublishSourceGroupId(groupId);
                setPublishTargetSelection(groupId && !publishGroupIds.includes(groupId) ? [...publishGroupIds, groupId] : publishGroupIds);
              }}
              helperText={
                publishSource
                  ? `Every selected fleet gets an exact copy of ${publishSource.label}'s pack contents, replacing its own pipelines, routes, lookups, sources, destinations, and local modifications.`
                  : 'Each fleet keeps its own pipelines, routes, lookups, sources, and destinations; only the metadata below changes, so fleets that differ stay different.'
              }
            >
              <SelectField.Item id={OWN_CONTENTS_KEY} textValue="Keep each fleet's own contents">
                Keep each fleet&apos;s own contents
              </SelectField.Item>
              {publishTargets.map((target) => (
                <SelectField.Item key={target.groupId} id={target.groupId} textValue={`Copy contents from ${target.label}`}>
                  Copy contents from {target.label}
                </SelectField.Item>
              ))}
            </SelectField>
          </div>
        ) : null}
        <fieldset className="publish-targets" disabled={isPackBusy}>
          <legend>
            <Text variant="body-xs-semibold" color="secondary">
              Fleets to update ({publishGroupIds.length} of {publishTargets.length} selected)
            </Text>
          </legend>
          {publishTargets.length === 0 ? (
            <Text variant="body-xs-normal" color="secondary">
              No fleets with this pack installed were found.
            </Text>
          ) : (
            <FleetTransferList
              options={publishTransferOptions}
              selectedIds={publishGroupIds}
              onChange={setPublishTargetSelection}
              disabled={isPackBusy}
              chosenTitle="Fleets to update"
            />
          )}
        </fieldset>
        <label className="metadata-row">
          <Text variant="body-xs-semibold" color="secondary">
            Current version
          </Text>
          <input
            className="search-input"
            value={selectedPack.version ?? '—'}
            readOnly
          />
        </label>
        <label className="metadata-row">
          <Text variant="body-xs-semibold" color="secondary">
            Display name
          </Text>
          <input
            className="search-input"
            value={packDraft.displayName}
            onChange={(event) => handlePackDraftChange('displayName', event.target.value)}
          />
        </label>
        <label className="metadata-row">
          <Text variant="body-xs-semibold" color="secondary">
            Author
          </Text>
          <input
            className="search-input"
            value={packDraft.author}
            onChange={(event) => handlePackDraftChange('author', event.target.value)}
          />
        </label>
        <label className="metadata-row" style={{ gridColumn: '1 / -1' }}>
          <Text variant="body-xs-semibold" color="secondary">
            Description
          </Text>
          <textarea
            className="search-input"
            value={packDraft.description}
            onChange={(event) => handlePackDraftChange('description', event.target.value)}
            rows={4}
          />
        </label>
        <label className="metadata-row">
          <Text variant="body-xs-semibold" color="secondary">
            Tags (comma-separated)
          </Text>
          <input
            className="search-input"
            value={packDraft.tags}
            onChange={(event) => handlePackDraftChange('tags', event.target.value)}
          />
        </label>
      </div>
    </div>
  ) : null;

  const commitMessageField =
    isConfirmingDeploy && pendingChanges ? (
      <label className="metadata-row commit-message-field">
        <Text variant="body-xs-semibold" color="secondary">
          Commit message
        </Text>
        <textarea
          className="search-input"
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          rows={2}
          required
          aria-invalid={commitMessage.trim() === ''}
        />
      </label>
    ) : null;

  const bannerStatus: Array<{ label: string; tone: 'alert' | 'info' | 'subtle' }> = selectedPack
    ? [
        ...(isEditingPack
          ? [
              changedFieldCount > 0
                ? { label: `${changedFieldCount} unsaved change${changedFieldCount === 1 ? '' : 's'}`, tone: 'alert' as const }
                : { label: 'Editing — no changes yet', tone: 'subtle' as const },
              ...(publishSource ? [{ label: `Copying contents from ${publishSource.label}`, tone: 'alert' as const }] : []),
            ]
          : []),
        ...(isEditingKnowledgeObject ? [{ label: 'Knowledge object edit in progress', tone: 'alert' as const }] : []),
        ...(deployPlan?.packId === selectedPack.id ? [{ label: 'Published — not deployed', tone: 'info' as const }] : []),
        ...(savedUncommittedPackIds.includes(selectedPack.id) ? [{ label: 'Saved — not committed', tone: 'info' as const }] : []),
        ...(deployPlan && deployPlan.packId !== selectedPack.id
          ? [{ label: `Undeployed changes in ${deployPlan.packId}`, tone: 'info' as const }]
          : []),
      ]
    : [];

  const fleetProducts = [...new Set(fleetTreeOptions.map((option) => option.location.product))];
  const renderFleetOption = ({ location, depth }: { location: PackUsageLocation; depth: number }) => (
    <SelectField.Item
      key={`${location.product}:${location.fleetId}`}
      id={`${location.product}:${location.fleetId}`}
      textValue={location.fleetName}
    >
      <span className="fleet-tree-option" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
        {depth > 0 ? (
          <span className="fleet-tree-branch" aria-hidden="true">
            └
          </span>
        ) : null}
        {location.fleetName}
      </span>
    </SelectField.Item>
  );

  const actionBanner = selectedPack ? (
    <>
    <div
      className={`pack-action-banner${bannerStatus.some((status) => status.tone !== 'subtle') ? ' pack-action-banner-pending' : ''}`}
      role="region"
      aria-label="Pack actions"
    >
      <div className="pack-action-banner-row">
        <div className="pack-action-banner-summary">
          <Text variant="body-md-semibold">{selectedPack.displayName || selectedPack.id}</Text>
          {visibleUsageLocations.length > 0 ? (
            <div className="pack-action-banner-fleet">
              <SelectField
                label="Viewing fleet"
                layout="horizontal"
                size="sm"
                value={selectedUsageContextKey}
                placeholder="Select a fleet"
                onChange={(key) => {
                  if (key !== null) {
                    setSelectedUsageContextKey(String(key));
                  }
                }}
                disabled={hasUnsavedDraft || isBusy}
                helperText={hasUnsavedDraft ? 'Save or cancel your edits to switch fleets.' : undefined}
                canSearch={visibleUsageLocations.length > 8}
              >
                {fleetProducts.length > 1
                  ? fleetProducts.map((product) => (
                      <SelectField.Section key={product}>
                        <SelectField.Header label={product === 'edge' ? 'Edge' : 'Stream'} />
                        {fleetTreeOptions.filter((option) => option.location.product === product).map(renderFleetOption)}
                      </SelectField.Section>
                    ))
                  : fleetTreeOptions.map(renderFleetOption)}
              </SelectField>
            </div>
          ) : null}
          <div className="pill-row pack-action-banner-status">
            {bannerStatus.length > 0 ? (
              bannerStatus.map((status) => (
                <span
                  key={status.label}
                  className={`pill${status.tone === 'alert' ? ' pack-version-pill' : status.tone === 'subtle' ? ' pill-subtle' : ''}`}
                >
                  {status.label}
                </span>
              ))
            ) : (
              <span className="pill pill-subtle">No pending changes</span>
            )}
          </div>
        </div>
        <div className="pack-action-banner-actions">
          {isEditingPack ? (
            <>
              <Button variant="primary" onClick={handlePublishPack} pending={isPackBusy} disabled={isPackBusy || isDeploying}>
                {isConfirmingOverwrite ? 'Confirm overwrite' : 'Publish'}
              </Button>
              <Button variant="tertiary" onClick={handleToggleEdit} disabled={isPackBusy}>
                Cancel edit
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={handleToggleEdit} disabled={isPackBusy || isDeploying}>
              Edit
            </Button>
          )}
          <Button
            variant={isConfirmingDeploy || deployPlan?.packId === selectedPack.id ? 'primary' : 'secondary'}
            onClick={handleCommitAndDeploy}
            pending={isDeploying}
            disabled={
              isDeploying || isPackBusy || deployTargets.length === 0 || (isConfirmingDeploy && commitMessage.trim() === '')
            }
          >
            {isConfirmingDeploy ? 'Confirm commit & deploy' : 'Commit & deploy'}
          </Button>
          {isConfirmingDeploy ? (
            <Button variant="tertiary" onClick={handleCancelDeploy}>
              Cancel deploy
            </Button>
          ) : null}
        </div>
      </div>
    </div>
    <div className="pack-action-details">
      <Text variant="body-xs-normal" color="secondary">
        Commit &amp; deploy targets: {deployTargets.map((target) => target.label).join(', ') || 'no fleets'}
      </Text>
      {updatePackMessage ? (
        <div className="pack-action-banner-message" role="status" aria-live="polite">
          <Text variant="body-xs-normal" color="secondary">
            {updatePackMessage}
          </Text>
        </div>
      ) : null}
      {deployMessage?.packId === selectedPack.id ? (
        <div className="pack-action-banner-message" role="status" aria-live="polite">
          <Text variant="body-xs-normal" color="secondary">
            {deployMessage.text}
          </Text>
        </div>
      ) : null}
      {commitMessageField}
      {isConfirmingDeploy && pendingChanges ? (
        <ul className="publish-results pack-action-banner-files" aria-label="Files to commit">
          {pendingChanges.packFiles.map((file) => (
            <li key={file} className="publish-result">
              <Text variant="body-xs-normal">{file}</Text>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
    </>
  ) : null;

  return (
    <>
    {isActionBarLayout ? (
      <Modal
        isOpen={isLeaveModalOpen}
        title={pendingPackSwitchId ? 'Switch packs and discard edits?' : 'Leave with pending changes?'}
        confirmButtonText={pendingPackSwitchId ? 'Discard and switch' : 'Leave page'}
        cancelButtonText="Stay"
        onConfirm={confirmLeave}
        onClose={cancelLeave}
      >
        <Text as="p" variant="body-sm-normal">
          {pendingPackSwitchId
            ? 'Switching packs discards these unsaved edits. This cannot be undone:'
            : 'You have pending changes on this page. Unsaved edits are discarded if you leave, and published or saved changes stay uncommitted until someone runs Commit & deploy:'}
        </Text>
        <ul className="pack-leave-reasons">
          {(pendingPackSwitchId ? unsavedDraftReasons : pendingReasons).map((reason) => (
            <li key={reason}>
              <Text variant="body-sm-normal">{reason}</Text>
            </li>
          ))}
        </ul>
      </Modal>
    ) : null}
    <section className="split-layout">
      <div className="panel">
        <div className="section-header">
          <Text as="h2" variant="heading-md">
            Packs
          </Text>
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Browse pack metadata and inspect the objects each pack contains.
            </Text>
          </div>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <Text variant="body-xs-semibold" color="secondary">
            Fleet product
          </Text>
          <div className="pill-row" style={{ marginTop: '0.35rem' }}>
            {(['all', 'stream', 'edge'] as const).map((option) => {
              const isSelected = productFilter === option;
              const label = option === 'all' ? 'All fleets' : option === 'stream' ? 'Stream' : 'Edge';

              return (
                <button
                  key={option}
                  type="button"
                  className={`pill${isSelected ? '' : ' pill-subtle'}`}
                  onClick={() => setProductFilter(option)}
                  aria-pressed={isSelected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <input
          className="search-input"
          type="search"
          placeholder="Search packs"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <div className="inheritance-summary-grid">
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Packs in view
            </Text>
            <Text as="div" variant="heading-md">
              {filteredPacks.length}
            </Text>
          </div>
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Fleets using packs
            </Text>
            <Text as="div" variant="heading-md">
              {summaryFleetCount}
            </Text>
          </div>
          <div className="inheritance-summary-card">
            <Text variant="body-xs-semibold" color="secondary">
              Referenced packs
            </Text>
            <Text as="div" variant="heading-md">
              {summaryReferenceCount}
            </Text>
          </div>
        </div>

        {filteredPacks.length === 0 ? (
          <EmptyState
            title="No packs match this filter"
            description="Try a different pack name, fleet product, or reference search."
          />
        ) : (
          <div className="list-stack list-stack-scroll">
            {filteredPacks.map((pack) => {
              const inheritanceLabel =
                pack.status === 'inherited-modified' ? 'Inherited modified' :
                pack.status === 'inherited' ? 'Inherited' : null;
              const usageCount = filterUsageLocationsByProduct(pack.usageLocations, productFilter).length;
              const deploymentGroups = buildPackDeploymentGroups(
                filterUsageLocationsByProduct(pack.usageLocations, productFilter),
                null,
              );
              const hasVersionMismatch = hasPackVersionMismatch(deploymentGroups);

              return (
                <button
                  key={pack.id}
                  type="button"
                  className={`list-card${selectedPack?.id === pack.id ? ' list-card-selected' : ''}`}
                  onClick={() => requestPackSelection(pack.id)}
                >
                  <div className="list-card-header">
                    <Text variant="body-md-semibold">{pack.displayName || pack.id}</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {inheritanceLabel ? <span className="inheritance-pill">{inheritanceLabel}</span> : null}
                      {pack.version ? <span className="pill">v{pack.version}</span> : null}
                    </div>
                  </div>
                  {pack.description ? (
                    <div className="section-copy">
                      <Text variant="body-sm-normal" color="secondary">
                        {pack.description}
                      </Text>
                    </div>
                  ) : null}
                  <div className="pill-row">
                    <span className="pill pill-subtle">Used by {usageCount} fleet{usageCount === 1 ? '' : 's'}</span>
                    <span className="pill pill-subtle">References {pack.references.length} pack{pack.references.length === 1 ? '' : 's'}</span>
                    {hasVersionMismatch ? <span className="pill pack-version-pill">Version metadata mismatch</span> : null}
                    {deploymentGroups.length > 1 ? (
                      <span className="pill pill-subtle">{deploymentGroups.length} content groups</span>
                    ) : null}
                  </div>
                  {pack.tags && pack.tags.length > 0 ? (
                    <div className="pill-row">
                      {pack.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="pill pill-subtle">
                          {tag}
                        </span>
                      ))}
                      {pack.tags.length > 4 ? (
                        <span className="pill pill-subtle">+{pack.tags.length - 4} more</span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        {selectedPack ? (
          <>
            <div className="section-header">
              <Text as="h2" variant="heading-md">
                Pack details
              </Text>
              <div className="section-copy">
                <Text variant="body-sm-normal" color="secondary">
                  Metadata and knowledge objects for the selected pack deployment context.
                </Text>
              </div>
            </div>

            {isActionBarLayout ? (
              <>
                {actionBanner}
                {publishResults?.packId === selectedPack.id && publishResults.items.length > 0 ? (
                  <PublishResultList items={publishResults.items} label="Publish results by fleet" successLabel="Published" />
                ) : null}
                {deployResults?.packId === selectedPack.id && deployResults.items.length > 0 ? (
                  <PublishResultList items={deployResults.items} label="Deploy results by fleet" successLabel="Deployed" />
                ) : null}
                {editForm}
              </>
            ) : null}

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Viewing deployment
              </Text>
              {!isActionBarLayout && visibleUsageLocations.length > 0 ? (
                <div className="pill-row" style={{ marginTop: '0.75rem' }}>
                  {visibleUsageLocations.map((usageLocation) => {
                    const usageKey = `${usageLocation.product}:${usageLocation.fleetId}`;
                    const isSelected = usageKey === selectedUsageContextKey;

                    return (
                      <button
                        key={usageKey}
                        type="button"
                        className={`pill${isSelected ? '' : ' pill-subtle'}`}
                        onClick={() => setSelectedUsageContextKey(usageKey)}
                        aria-pressed={isSelected}
                      >
                        {usageLocation.fleetName}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {selectedUsageLocation ? (
                <>
                  <div className="section-copy">
                    <Text variant="body-sm-normal" color="secondary">
                      You are viewing the pack as deployed in {selectedUsageLocation.fleetName}. Pack content can differ across fleets even when the version matches.
                    </Text>
                  </div>

                  <div className="metadata-grid" style={{ marginTop: '1rem' }}>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Fleet
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.fleetName}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Product
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.product}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Group context
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.fleetId}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Resolved status
                      </Text>
                      <Text variant="body-md-normal">
                        {selectedUsageLocation.status === 'inherited-modified'
                          ? 'Inherited modified'
                          : selectedUsageLocation.status === 'inherited'
                            ? 'Inherited'
                            : selectedUsageLocation.status === 'local'
                              ? 'Local'
                              : 'Unknown'}
                      </Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Inherited from
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.inheritedFrom ?? '—'}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Config drift
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.configDrift ? 'Yes' : 'No'}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Deployment version
                      </Text>
                      <Text variant="body-md-normal">{selectedUsageLocation.version ?? selectedPack.version ?? '—'}</Text>
                    </div>
                    <div className="metadata-row">
                      <Text variant="body-xs-semibold" color="secondary">
                        Content summary
                      </Text>
                      <Text variant="body-md-normal">
                        {formatInventoryLabel(
                          packKnowledgeInventories?.get(`${selectedUsageLocation.product}:${selectedUsageLocation.fleetId}`),
                        )}
                      </Text>
                    </div>
                  </div>

                  <div className="pill-row" style={{ marginTop: '1rem' }}>
                    {hasPackVersionMismatch(visibleDeploymentGroups) ? (
                      <span className="pill pack-version-pill">Different version metadata deployed</span>
                    ) : (
                      <span className="pill pill-subtle">Same version metadata across visible fleets</span>
                    )}
                    <span className="pill pill-subtle">
                      {comparableGroupCount} content-identical deployment group{comparableGroupCount === 1 ? '' : 's'}
                    </span>
                    {notComparedFleetCount > 0 ? (
                      <span className="pill pack-version-pill">
                        {notComparedFleetCount} fleet{notComparedFleetCount === 1 ? '' : 's'} not compared
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="section-copy">
                  <Text variant="body-sm-normal" color="secondary">
                    {needsFleetSelection
                      ? `Select a fleet ${isActionBarLayout ? 'in "Viewing fleet" above' : 'above'} to see this pack as deployed there.`
                      : 'No fleet-scoped deployment is available for the current filter.'}
                  </Text>
                </div>
              )}
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Content-identical deployment groups
              </Text>
              <div className="section-copy">
                <Text variant="body-sm-normal" color="secondary">
                  Fleets are grouped only when every pipeline and route definition matches
                  and every lookup file has the same size (rows, descriptions and tags are not compared). Fleets whose contents
                  could not be fully read are listed on their own and not compared.
                </Text>
              </div>
              {groupSync?.packId === selectedPack.id && groupSync.message ? (
                <div className="section-copy" role="status">
                  <Text variant="body-sm-normal">{groupSync.message}</Text>
                </div>
              ) : null}
              {groupSync?.packId === selectedPack.id && groupSync.items.length > 0 ? (
                <PublishResultList items={groupSync.items} label="Make identical results" successLabel="Updated" />
              ) : null}
              {inventoriesLoading ? (
                <SkeletonLoader count={2} />
              ) : inventoriesError ? (
                <ErrorState error={inventoriesError} onRetry={retryInventories} />
              ) : visibleDeploymentGroups.length > 0 ? (
                <div className="list-stack" style={{ marginTop: '0.75rem' }}>
                  {visibleDeploymentGroups.map((group) => {
                    const isSelectedGroup = Boolean(
                      selectedUsageLocation && group.usageLocations.some(
                        (usageLocation) =>
                          usageLocation.fleetId === selectedUsageLocation.fleetId &&
                          usageLocation.product === selectedUsageLocation.product,
                      ),
                    );

                    return (
                      <div
                        key={group.key}
                        className={`detail-card pack-relationship-card${isSelectedGroup ? ' list-card-selected' : ''}`}
                      >
                        <div className="list-card-header">
                          <Text variant="body-sm-semibold">{group.versionLabel}</Text>
                          <span className={`pill${hasVersionLabel(group.versionLabel) ? ' pack-version-pill' : ' pill-subtle'}`}>
                            {group.usageLocations.length} fleet{group.usageLocations.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="pill-row" style={{ marginTop: '0.5rem' }}>
                          {!group.comparable ? <span className="pill pack-version-pill">Not compared</span> : null}
                          <span className="pill pill-subtle">{group.statusLabel}</span>
                          <span className="pill pill-subtle">Inherited from {group.inheritedFromLabel}</span>
                          <span className="pill pill-subtle">{group.configDriftLabel}</span>
                          <span className="pill pill-subtle">{group.inventoryLabel}</span>
                        </div>
                        <div className="section-copy">
                          <Text variant="body-xs-normal" color="secondary">
                            {group.comparable ? 'Fleets in this identical group' : 'Fleet'}:{' '}
                            {group.usageLocations
                              .map((usageLocation) =>
                                fleetProducts.length > 1
                                  ? `${usageLocation.fleetName} (${usageLocation.product === 'edge' ? 'Edge' : 'Stream'})`
                                  : usageLocation.fleetName,
                              )
                              .join(', ')}
                          </Text>
                          {group.notes.map((note) => (
                            <Text key={note} variant="body-xs-normal" color="secondary">
                              {note}
                            </Text>
                          ))}
                          {group.differences.length > 0 ? (
                            <Text variant="body-xs-normal" color="secondary">
                              Differs from the largest group: {group.differences.slice(0, 8).map(formatInventoryDifference).join(', ')}
                              {group.differences.length > 8 ? `, and ${group.differences.length - 8} more` : ''}
                            </Text>
                          ) : null}
                        </div>
                        {referenceFleet && group.differences.some(isCopyableDifference) ? (
                          <div className="pill-row" style={{ marginTop: '0.5rem' }}>
                            {groupSync?.packId === selectedPack.id && groupSync.groupKey === group.key && groupSync.confirming ? (
                              <>
                                <Button variant="primary" onClick={() => void handleSyncGroup(group)} disabled={isGroupSyncRunning}>
                                  Confirm overwrite
                                </Button>
                                <Button variant="tertiary" onClick={handleCancelGroupSync} disabled={isGroupSyncRunning}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="secondary"
                                onClick={() => void handleSyncGroup(group)}
                                pending={isGroupSyncRunning && groupSync?.groupKey === group.key}
                                disabled={isGroupSyncRunning || isPackBusy || isDeploying}
                              >
                                {`Make identical to ${referenceFleet.fleetName}`}
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="section-copy">
                  <Text variant="body-sm-normal" color="secondary">
                    No grouped deployment data is available for the current filter.
                  </Text>
                </div>
              )}
            </div>

            <div className="metadata-grid">
              <div className="metadata-row">
                <Text variant="body-xs-semibold" color="secondary">
                  ID
                </Text>
                <Text variant="body-md-normal">{selectedPack.id}</Text>
              </div>
              {selectedPack.status ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Aggregated inheritance
                  </Text>
                  <Text variant="body-md-normal">
                    {selectedPack.status === 'inherited-modified'
                      ? 'Inherited modified'
                      : selectedPack.status === 'inherited'
                        ? 'Inherited'
                        : 'Local'}
                  </Text>
                </div>
              ) : null}
              {selectedPack.version ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Catalog version
                  </Text>
                  <Text variant="body-md-normal">{selectedPack.version}</Text>
                </div>
              ) : null}
              {selectedPack.author ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Author
                  </Text>
                  <Text variant="body-md-normal">{selectedPack.author}</Text>
                </div>
              ) : null}
              {selectedPack.description ? (
                <div className="metadata-row">
                  <Text variant="body-xs-semibold" color="secondary">
                    Description
                  </Text>
                  <Text variant="body-md-normal">{selectedPack.description}</Text>
                </div>
              ) : null}
            </div>

            {!isActionBarLayout ? (
            <>
            <div className="pill-row" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="pill"
                onClick={handleToggleEdit}
                disabled={updatingPackId === selectedPack.id}
              >
                {isEditingPack ? 'Cancel edit' : 'Edit'}
              </button>
              {isEditingPack ? (
                <button
                  type="button"
                  className="pill"
                  onClick={handlePublishPack}
                  disabled={updatingPackId === selectedPack.id}
                >
                  {updatingPackId === selectedPack.id
                    ? 'Publishing…'
                    : isConfirmingOverwrite
                      ? 'Confirm overwrite'
                      : 'Publish'}
                </button>
              ) : null}
            </div>

            {updatePackMessage ? (
              <div style={{ marginTop: '0.75rem' }} role="status" aria-live="polite">
                <Text variant="body-xs-normal" color="secondary">
                  {updatePackMessage}
                </Text>
              </div>
            ) : null}

            {publishResults?.packId === selectedPack.id && publishResults.items.length > 0 ? (
              <PublishResultList items={publishResults.items} label="Publish results by fleet" successLabel="Published" />
            ) : null}

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Commit &amp; deploy
              </Text>
              <div className="section-copy">
                <Text variant="body-xs-normal" color="secondary">
                  Published changes only reach fleets after they are committed and deployed. This commits only this pack&apos;s
                  files and deploys to: {deployTargets.map((target) => target.label).join(', ') || 'no fleets'}.
                </Text>
              </div>
              <div className="pill-row">
                <button
                  type="button"
                  className="pill"
                  onClick={handleCommitAndDeploy}
                  disabled={
                    isDeploying ||
                    updatingPackId === selectedPack.id ||
                    deployTargets.length === 0 ||
                    (isConfirmingDeploy && commitMessage.trim() === '')
                  }
                >
                  {isDeploying ? 'Working…' : isConfirmingDeploy ? 'Confirm commit & deploy' : 'Commit & deploy'}
                </button>
                {isConfirmingDeploy ? (
                  <button
                    type="button"
                    className="pill pill-subtle"
                    onClick={handleCancelDeploy}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {deployMessage?.packId === selectedPack.id ? (
                <div style={{ marginTop: '0.75rem' }} role="status" aria-live="polite">
                  <Text variant="body-xs-normal" color="secondary">
                    {deployMessage.text}
                  </Text>
                </div>
              ) : null}
              {commitMessageField}
              {isConfirmingDeploy && pendingChanges ? (
                <ul className="publish-results" aria-label="Files to commit">
                  {pendingChanges.packFiles.map((file) => (
                    <li key={file} className="publish-result">
                      <Text variant="body-xs-normal">{file}</Text>
                    </li>
                  ))}
                </ul>
              ) : null}
              {deployResults?.packId === selectedPack.id && deployResults.items.length > 0 ? (
                <PublishResultList items={deployResults.items} label="Deploy results by fleet" successLabel="Deployed" />
              ) : null}
            </div>

            {editForm}
            </>
            ) : null}

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Referenced packs
              </Text>
              <PackReferenceList
                references={selectedPack.references}
                emptyText="This pack does not declare references to other packs."
              />
            </div>

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Referenced by
              </Text>
              <PackReferenceList
                references={selectedPack.referencedBy}
                emptyText="No other visible pack references this pack."
              />
            </div>

            {selectedPack.tags && selectedPack.tags.length > 0 ? (
              <div className="detail-section">
                <Text as="h3" variant="heading-sm">
                  Tags
                </Text>
                <div className="pill-row">
                  {selectedPack.tags.map((tag) => (
                    <span key={tag} className="pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="detail-section">
              <Text as="h3" variant="heading-sm">
                Knowledge objects
              </Text>

              <div style={{ margin: '0.75rem 0 0.5rem' }}>
                <Text variant="body-xs-semibold" color="secondary">
                  Filter by type
                </Text>
                <div className="pill-row" style={{ marginTop: '0.35rem' }}>
                  {KNOWLEDGE_OBJECT_TYPES.map((option) => {
                    const isSelected = knowledgeObjectTypeFilter === option;
                    const label = option === 'all' ? 'All' : option.charAt(0).toUpperCase() + option.slice(1) + 's';

                    return (
                      <button
                        key={option}
                        type="button"
                        className={`pill${isSelected ? '' : ' pill-subtle'}`}
                        onClick={() => setKnowledgeObjectTypeFilter(option)}
                        aria-pressed={isSelected}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <Text variant="body-xs-semibold" color="secondary">
                  Sort by name
                </Text>
                <div className="pill-row" style={{ marginTop: '0.35rem' }}>
                  <button
                    type="button"
                    className={`pill${knowledgeObjectSortMode === 'name-asc' ? '' : ' pill-subtle'}`}
                    onClick={() => setKnowledgeObjectSortMode('name-asc')}
                  >
                    A–Z
                  </button>
                  <button
                    type="button"
                    className={`pill${knowledgeObjectSortMode === 'name-desc' ? '' : ' pill-subtle'}`}
                    onClick={() => setKnowledgeObjectSortMode('name-desc')}
                  >
                    Z–A
                  </button>
                </div>
              </div>

              {needsFleetSelection ? (
                <EmptyState
                  title="Select a fleet"
                  description="Choose the fleet you want to inspect. Knowledge objects are shown as deployed in that fleet."
                />
              ) : koLoading ? (
                <SkeletonLoader count={3} />
              ) : knowledgeError ? (
                <ErrorState error={knowledgeError} onRetry={retryKnowledge} />
              ) : (
                <>
                  <KnowledgeObjectGroups
                    knowledgeObjects={visibleKnowledgeObjects}
                    typeFilter={knowledgeObjectTypeFilter}
                    selectedKnowledgeObjectKey={selectedKnowledgeObject ? `${selectedKnowledgeObject.type}:${selectedKnowledgeObject.id}` : null}
                    onSelectKnowledgeObject={(knowledgeObject) => setSelectedKnowledgeObject((current) => {
                      if (
                        current &&
                        current.type === knowledgeObject.type &&
                        current.id === knowledgeObject.id
                      ) {
                        return null;
                      }

                      return knowledgeObject;
                    })}
                    renderPreview={(knowledgeObject) => (
                      <KnowledgeObjectPreviewPanel
                        key={`${knowledgeObject.type}:${knowledgeObject.id}:${selectedGroupId ?? ''}`}
                        packId={selectedPack.id}
                        groupId={selectedGroupId}
                        fleetLabel={selectedUsageLocation?.fleetName ?? selectedGroupId ?? 'the Leader'}
                        knowledgeObject={knowledgeObject}
                        preview={preview}
                        loading={previewLoading}
                        error={previewError}
                        onRetry={retryPreview}
                        onEditingChange={setIsEditingKnowledgeObject}
                        onSaved={handleKnowledgeObjectSaved}
                        otherFleets={buildCopyTargets(knowledgeObject)}
                      />
                    )}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title="Select a pack"
            description="Choose a pack from the list to inspect its metadata and objects."
          />
        )}
      </div>
    </section>
    </>
  );
}

function filterUsageLocationsByProduct(
  usageLocations: PackUsageLocation[],
  productFilter: FleetProductFilter,
): PackUsageLocation[] {
  return productFilter === 'all'
    ? usageLocations
    : usageLocations.filter((usageLocation) => usageLocation.product === productFilter);
}

function formatPackStatusLabel(status: PackUsageLocation['status']): string {
  if (status === 'inherited-modified') {
    return 'Inherited modified';
  }

  if (status === 'inherited') {
    return 'Inherited';
  }

  if (status === 'local') {
    return 'Local';
  }

  return 'Unknown';
}

function buildPackDeploymentGroups(
  usageLocations: PackUsageLocation[],
  inventories: Map<string, PackKnowledgeInventory> | null,
): PackDeploymentGroup[] {
  const groups = new Map<string, PackDeploymentGroup>();

  usageLocations.forEach((usageLocation) => {
    const locationKey = `${usageLocation.product}:${usageLocation.fleetId}`;
    const inventory = inventories?.get(locationKey);
    const gap = describeInventoryGap(inventory);
    const inventorySignature = buildInventorySignature(inventory?.objects ?? []);
    const inventoryLabel = formatInventoryLabel(inventory);
    // Fleets whose contents could not be fully read are never merged into a group with others.
    const key = gap ? `incomplete:${locationKey}` : inventorySignature || 'empty-inventory';
    const readFromNote = inventory?.readFromGroupId
      ? `${usageLocation.fleetName} returned no contents of its own; they were read from ${inventory.readFromGroupId}, the fleet it inherits from.`
      : undefined;
    const existing = groups.get(key);

    if (existing) {
      existing.usageLocations.push(usageLocation);
      if (readFromNote) {
        existing.notes.push(readFromNote);
      }
      return;
    }

    groups.set(key, {
      key,
      versionLabel: '',
      statusLabel: '',
      inheritedFromLabel: '',
      configDriftLabel: '',
      inventoryLabel,
      inventorySignature,
      comparable: !gap,
      notes: [...(gap ? [gap] : []), ...(readFromNote ? [readFromNote] : [])],
      differences: [],
      objects: inventory?.objects ?? [],
      usageLocations: [usageLocation],
    });
  });

  groups.forEach((group) => {
    group.versionLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => usageLocation.version ? `v${usageLocation.version}` : 'Version unavailable'),
      'Mixed version metadata',
    );
    group.statusLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => formatPackStatusLabel(usageLocation.status)),
      'Mixed status metadata',
    );
    group.inheritedFromLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => usageLocation.inheritedFrom ?? 'local source'),
      'Multiple inheritance sources',
    );
    group.configDriftLabel = summarizeGroupValues(
      group.usageLocations.map((usageLocation) => usageLocation.configDrift ? 'Config drift detected' : 'No config drift'),
      'Mixed config drift state',
    );
  });

  const sortedGroups = Array.from(groups.values()).sort((left, right) => {
    if (left.comparable !== right.comparable) {
      return left.comparable ? -1 : 1;
    }

    const fleetCountOrder = right.usageLocations.length - left.usageLocations.length;

    if (fleetCountOrder !== 0) {
      return fleetCountOrder;
    }

    return left.inventoryLabel.localeCompare(right.inventoryLabel);
  });
  const referenceGroup = sortedGroups.find((group) => group.comparable);

  if (referenceGroup) {
    sortedGroups.forEach((group) => {
      if (group !== referenceGroup && group.comparable) {
        group.differences = describeInventoryDifferences(group.objects, referenceGroup.objects);
      }
    });
  }

  return sortedGroups;
}

/** Lists objects that are missing, extra, or defined differently compared with the reference group. */
function describeInventoryDifferences(
  objects: KnowledgeObject[],
  referenceObjects: KnowledgeObject[],
): InventoryDifference[] {
  const keyOf = (knowledgeObject: KnowledgeObject) => `${knowledgeObject.type}:${knowledgeObject.id}`;
  const toDifference = (knowledgeObject: KnowledgeObject, kind: InventoryDifference['kind']): InventoryDifference => ({
    type: knowledgeObject.type,
    id: knowledgeObject.id,
    name: knowledgeObject.name,
    kind,
  });
  const reference = new Map(referenceObjects.map((knowledgeObject) => [keyOf(knowledgeObject), knowledgeObject]));
  const own = new Map(objects.map((knowledgeObject) => [keyOf(knowledgeObject), knowledgeObject]));
  const differences: InventoryDifference[] = [];

  own.forEach((knowledgeObject, key) => {
    const match = reference.get(key);

    if (!match) {
      differences.push(toDifference(knowledgeObject, 'extra'));
    } else if (match.fingerprint !== knowledgeObject.fingerprint) {
      differences.push(toDifference(knowledgeObject, 'differs'));
    }
  });

  reference.forEach((knowledgeObject, key) => {
    if (!own.has(key)) {
      differences.push(toDifference(knowledgeObject, 'missing'));
    }
  });

  return differences.sort((left, right) => formatInventoryDifference(left).localeCompare(formatInventoryDifference(right)));
}

function hasPackVersionMismatch(groups: PackDeploymentGroup[]): boolean {
  const versions = new Set(groups.map((group) => group.versionLabel));
  return versions.size > 1;
}

function hasVersionLabel(versionLabel: string): boolean {
  return versionLabel !== 'Version unavailable' && versionLabel !== 'Mixed version metadata';
}

function summarizeGroupValues(values: string[], mixedLabel: string): string {
  const uniqueValues = Array.from(new Set(values));

  if (uniqueValues.length === 0) {
    return 'Unknown';
  }

  if (uniqueValues.length === 1) {
    return uniqueValues[0];
  }

  return mixedLabel;
}

/** Why a fleet's contents cannot be compared, or undefined when every object type was read. */
function describeInventoryGap(inventory: PackKnowledgeInventory | undefined): string | undefined {
  if (!inventory) {
    return 'Contents were not loaded.';
  }

  if (inventory.error) {
    return `Contents could not be read: ${inventory.error}`;
  }

  if (inventory.failedTypes.length > 0) {
    return `Could not read ${inventory.failedTypes.map((type) => `${type}s`).join(', ')}, so this fleet is not compared.`;
  }

  return undefined;
}

function buildInventorySignature(inventory: KnowledgeObject[]): string {
  const normalized = [...inventory]
    .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))
    .map((knowledgeObject) => `${knowledgeObject.type}:${knowledgeObject.id}:${knowledgeObject.fingerprint ?? ''}`);

  return normalized.join('|');
}

function formatInventoryLabel(inventory: PackKnowledgeInventory | undefined): string {
  if (inventory?.error) {
    return 'Contents unavailable';
  }

  const objects = inventory?.objects ?? [];

  if (objects.length === 0) {
    return 'No knowledge objects';
  }

  const counts = new Map<string, number>();

  objects.forEach((knowledgeObject) => {
    counts.set(knowledgeObject.type, (counts.get(knowledgeObject.type) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`)
    .join(', ');
}

function PackReferenceList({ references, emptyText }: { references: PackReference[]; emptyText: string }) {
  if (references.length === 0) {
    return (
      <div className="section-copy">
        <Text variant="body-sm-normal" color="secondary">
          {emptyText}
        </Text>
      </div>
    );
  }

  return (
    <div className="pill-row" style={{ marginTop: '0.75rem' }}>
      {references.map((reference) => (
        <span key={reference.packId} className={`pill${reference.exists ? '' : ' pill-subtle'}`}>
          {reference.packDisplayName}
        </span>
      ))}
    </div>
  );
}

function parseJsonObjectDraft(draft: string, expectedId: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(draft);
  } catch (error) {
    throw new Error(`The ${label} JSON is not valid: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The ${label} JSON must be an object.`);
  }

  const record = parsed as Record<string, unknown>;
  if (record.id !== undefined && record.id !== expectedId) {
    throw new Error(`Renaming is not supported here. Keep "id" set to "${expectedId}".`);
  }

  return record;
}

function KnowledgeObjectPreviewPanel({
  packId,
  groupId,
  fleetLabel,
  knowledgeObject,
  preview,
  loading,
  error,
  onRetry,
  onEditingChange,
  onSaved,
  otherFleets = [],
}: {
  packId: string;
  groupId?: string;
  fleetLabel: string;
  knowledgeObject: KnowledgeObject;
  preview: Awaited<ReturnType<typeof useKnowledgeObjectPreview>>['data'];
  loading: boolean;
  error: Awaited<ReturnType<typeof useKnowledgeObjectPreview>>['error'];
  onRetry: () => void;
  onEditingChange?: (isEditing: boolean) => void;
  onSaved?: () => void;
  /** Other fleets holding their own copy of the pack, which the same edit can also be written to. */
  otherFleets?: KnowledgeObjectCopyTarget[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [lookupDraft, setLookupDraft] = useState<string[][]>([]);
  const [deletedRowIndexes, setDeletedRowIndexes] = useState<number[]>([]);
  const [newLookupRows, setNewLookupRows] = useState<string[][]>([]);
  const [alsoApplyGroupIds, setAlsoApplyGroupIds] = useState<string[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copyResults, setCopyResults] = useState<PackPublishResult[]>([]);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);

  const lookupIdIndex = preview?.kind === 'lookup' ? preview.lookup.fields.indexOf('__id') : -1;
  const lookupEditable =
    preview?.kind === 'lookup' &&
    lookupIdIndex >= 0 &&
    preview.lookup.rows.every((row) => row.length === preview.lookup.fields.length);
  const canEdit =
    preview?.kind === 'pipeline' || preview?.kind === 'route' || preview?.kind === 'source' || preview?.kind === 'destination' || lookupEditable;

  const lookupPatches = useMemo((): LookupRowPatch[] => {
    if (preview?.kind !== 'lookup' || !lookupEditable) {
      return [];
    }

    const withoutId = (cells: string[]) => cells.filter((_, cellIndex) => cellIndex !== lookupIdIndex);
    const rowIdAt = (rowIndex: number) => Number(preview.lookup.rows[rowIndex][lookupIdIndex]);
    const replaces: LookupRowPatch[] = preview.lookup.rows.flatMap((row, rowIndex) => {
      const draft = lookupDraft[rowIndex];

      if (
        deletedRowIndexes.includes(rowIndex) ||
        !draft ||
        draft.every((cell, cellIndex) => cell === String(row[cellIndex]))
      ) {
        return [];
      }

      return [{ op: 'replace' as const, rowId: rowIdAt(rowIndex), value: withoutId(draft) }];
    });
    // Remove from the bottom up so earlier row numbers stay valid while rows are deleted.
    const removes: LookupRowPatch[] = deletedRowIndexes
      .map(rowIdAt)
      .sort((left, right) => right - left)
      .map((rowId) => ({ op: 'remove' as const, rowId }));
    const adds: LookupRowPatch[] = newLookupRows.map((row, index) => ({
      op: 'add' as const,
      rowId: preview.lookup.totalCount + index + 1,
      value: withoutId(row),
    }));

    return [...replaces, ...removes, ...adds];
  }, [deletedRowIndexes, lookupDraft, lookupEditable, lookupIdIndex, newLookupRows, preview]);

  const updateNewLookupCell = (rowIndex: number, cellIndex: number, value: string) => {
    setIsConfirming(false);
    setNewLookupRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? row.map((cell, index2) => (index2 === cellIndex ? value : cell)) : row,
      ),
    );
  };

  const startEditing = () => {
    if (preview?.kind === 'pipeline') {
      setJsonDraft(JSON.stringify(preview.pipeline.definition, null, 2));
    } else if (preview?.kind === 'route') {
      setJsonDraft(JSON.stringify(preview.route.raw, null, 2));
    } else if (preview?.kind === 'source' || preview?.kind === 'destination') {
      setJsonDraft(JSON.stringify(preview.definition, null, 2));
    } else if (preview?.kind === 'lookup') {
      setLookupDraft(preview.lookup.rows.map((row) => row.map(String)));
      setDeletedRowIndexes([]);
      setNewLookupRows([]);
    }

    setIsEditing(true);
    setIsConfirming(false);
    setAlsoApplyGroupIds([]);
    setCopyResults([]);
    setMessage(null);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setIsConfirming(false);
    setMessage('Edit cancelled. Nothing was changed.');
  };

  const handleSave = async () => {
    if (!preview) {
      return;
    }

    const typeLabel = preview.kind;
    const target = `${typeLabel} "${knowledgeObject.name}" in pack "${packId}" on ${fleetLabel}`;
    const copyTargets = otherFleets.filter((fleet) => alsoApplyGroupIds.includes(fleet.groupId));
    let save: () => Promise<string | void>;
    let copyTo: (targetGroupId: string) => Promise<void>;
    let summary: string;

    try {
      if (preview.kind === 'pipeline') {
        const definition = parseJsonObjectDraft(jsonDraft, knowledgeObject.id, 'pipeline');
        if (JSON.stringify(definition) === JSON.stringify(preview.pipeline.definition) && copyTargets.length === 0) {
          setMessage('No changes to save.');
          return;
        }
        save = () => updatePackPipeline(packId, knowledgeObject.id, definition, groupId);
        copyTo = (targetGroupId) => updatePackPipeline(packId, knowledgeObject.id, definition, targetGroupId);
        summary = 'Cribl replaces the whole pipeline with the JSON above; any field you removed is deleted.';
      } else if (preview.kind === 'route') {
        const routeId = preview.route.id;
        const route = parseJsonObjectDraft(jsonDraft, routeId, 'route');
        if (JSON.stringify(route) === JSON.stringify(preview.route.raw) && copyTargets.length === 0) {
          setMessage('No changes to save.');
          return;
        }
        save = () => updatePackRoute(packId, routeId, route, groupId);
        copyTo = (targetGroupId) => updatePackRoute(packId, routeId, route, targetGroupId);
        summary = `Cribl rewrites routing table "${preview.route.tableId ?? 'default'}"; other routes in it are kept as they are now.`;
      } else if (preview.kind === 'source' || preview.kind === 'destination') {
        const ioType = preview.kind;
        const definition = parseJsonObjectDraft(jsonDraft, knowledgeObject.id, ioType);
        if (JSON.stringify(definition) === JSON.stringify(preview.definition) && copyTargets.length === 0) {
          setMessage('No changes to save.');
          return;
        }
        save = () => updatePackIoObject(packId, ioType, knowledgeObject.id, definition, groupId);
        copyTo = (targetGroupId) => updatePackIoObject(packId, ioType, knowledgeObject.id, definition, targetGroupId);
        summary = `Cribl replaces the whole ${ioType} with the JSON above; any field you removed is deleted.`;
        if (copyTargets.length > 0) {
          summary += ` ${PACK_IO_SECRET_NOTE}`;
        }
      } else {
        if (lookupPatches.length === 0 && copyTargets.length === 0) {
          setMessage('No changes to save.');
          return;
        }
        const patches = lookupPatches;
        const describe = (op: LookupRowPatch['op'], verb: string) => {
          const rowIds = patches.filter((patch) => patch.op === op).map((patch) => patch.rowId);
          return rowIds.length > 0 ? `${verb} row${rowIds.length === 1 ? '' : 's'} ${rowIds.join(', ')}` : null;
        };
        const addCount = patches.filter((patch) => patch.op === 'add').length;
        save = async () => (patches.length > 0 ? updatePackLookupRows(packId, knowledgeObject.id, patches, groupId) : undefined);
        copyTo = (targetGroupId) => copyPackLookupFile(packId, knowledgeObject.id, groupId, targetGroupId);
        summary = patches.length > 0
          ? `${[
              describe('replace', 'Replace'),
              describe('remove', 'Delete'),
              addCount > 0 ? `Add ${addCount} new row${addCount === 1 ? '' : 's'} at the end` : null,
            ].filter(Boolean).join('; ')}. If Cribl rejects the row edit, the app rewrites the whole lookup file with these same changes.`
          : 'No rows change here.';
        if (copyTargets.length > 0) {
          summary += ` The other fleets get a copy of the whole saved file from ${fleetLabel}, replacing every row they have now.`;
        }
      }
    } catch (validationError) {
      setIsConfirming(false);
      setMessage(validationError instanceof Error ? validationError.message : String(validationError));
      return;
    }

    const copySummary = copyTargets.length > 0
      ? ` The same ${typeLabel} is also overwritten in: ${copyTargets.map((fleet) => fleet.label).join(', ')}.`
      : '';

    if (!isConfirming) {
      setIsConfirming(true);
      setMessage(`This will overwrite the ${target}.${copySummary} ${summary} This cannot be undone from this app. Click Confirm save to continue.`);
      return;
    }

    setIsConfirming(false);
    setIsSaving(true);
    setCopyResults([]);
    setMessage(`Saving the ${target}…`);

    let method: string | void;
    try {
      method = await save();
    } catch (saveError) {
      setMessage(`Save failed, so nothing was changed in any fleet: ${describeApiError(saveError)}`);
      setIsSaving(false);
      return;
    }

    const results: PackPublishResult[] = [];
    for (const [index, fleet] of copyTargets.entries()) {
      setMessage(`[${index + 1}/${copyTargets.length}] Applying the ${typeLabel} to ${fleet.label}…`);

      try {
        await copyTo(fleet.groupId);
        results.push({ groupId: fleet.groupId, label: fleet.label, tone: 'success', message: `Overwritten with the ${typeLabel} from ${fleetLabel}.` });
      } catch (copyError) {
        results.push({ groupId: fleet.groupId, label: fleet.label, tone: 'error', message: describeApiError(copyError) });
      }
    }

    const failedCount = results.filter((result) => result.tone === 'error').length;
    setIsEditing(false);
    setIsSaving(false);
    setCopyResults(results);
    onSaved?.();
    setMessage(
      `Saved the ${target}${method === 'full-file' ? ' by rewriting the whole file (Cribl rejected the row-level edit)' : ''}` +
        `${copyTargets.length > 0 ? ` and applied it to ${copyTargets.length - failedCount} of ${copyTargets.length} other fleet${copyTargets.length === 1 ? '' : 's'}` : ''}. ` +
        'The change is uncommitted; use Commit & deploy above to roll it out.',
    );
    onRetry();
  };

  return (
    <div className="detail-section">
      <div className="list-card-header">
        <Text as="h3" variant="heading-sm">
          Selected content
        </Text>
        {!loading && !error && canEdit ? (
          <div className="pill-row" style={{ marginTop: 0 }}>
            {isEditing ? (
              <>
                <button type="button" className="pill" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving…' : isConfirming ? 'Confirm save' : 'Save'}
                </button>
                <button type="button" className="pill pill-subtle" onClick={cancelEditing} disabled={isSaving}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="pill" onClick={startEditing}>
                Edit
              </button>
            )}
          </div>
        ) : null}
      </div>

      {message ? (
        <div style={{ marginTop: '0.5rem' }} role="status" aria-live="polite">
          <Text variant="body-xs-normal" color="secondary">
            {message}
          </Text>
        </div>
      ) : null}

      {copyResults.length > 0 ? (
        <PublishResultList items={copyResults} label="Results in other fleets" successLabel="Applied" />
      ) : null}

      {isEditing && otherFleets.length > 0 ? (
        <fieldset className="publish-targets" disabled={isSaving}>
          <legend>
            <Text variant="body-xs-semibold" color="secondary">
              Also apply to ({alsoApplyGroupIds.length} of {otherFleets.length} selected)
            </Text>
          </legend>
          <Text variant="body-xs-normal" color="secondary">
            {preview?.kind === 'lookup'
              ? `Selected fleets get a copy of the whole file as saved on ${fleetLabel}.`
              : `Selected fleets get the same ${preview?.kind ?? 'definition'} as saved on ${fleetLabel}.`}
          </Text>
          <FleetTransferList
            options={otherFleets.map((fleet) => ({
              id: fleet.groupId,
              label: fleet.label,
              product: fleet.product,
              disabledReason: fleet.missing ? 'This fleet has no such object' : undefined,
              detail: () => (fleet.inheritedBy.length > 0 ? `Also inherited by: ${fleet.inheritedBy.join(', ')}` : ''),
            }))}
            selectedIds={alsoApplyGroupIds}
            onChange={(groupIds) => {
              setIsConfirming(false);
              setAlsoApplyGroupIds(groupIds);
            }}
            disabled={isSaving}
            chosenTitle="Also apply to"
          />
        </fieldset>
      ) : null}

      {loading ? <SkeletonLoader count={2} /> : null}
      {!loading && error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && preview?.kind === 'lookup' ? (
        <div className="preview-card">
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Showing {preview.lookup.rows.length} of {preview.lookup.totalCount} rows for {knowledgeObject.name}.
              {isEditing ? ' Only the rows shown here can be edited or deleted; new rows are added at the end of the file.' : ''}
              {!lookupEditable ? ' Editing is unavailable because Cribl did not return row ids for this lookup.' : ''}
            </Text>
          </div>
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  {preview.lookup.fields.map((field) => (
                    <th key={field}>{field}</th>
                  ))}
                  {isEditing ? <th aria-label="Row actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {preview.lookup.rows.map((row, index) => {
                  const isDeleted = isEditing && deletedRowIndexes.includes(index);

                  return (
                  <tr key={`${knowledgeObject.id}:${index}`} className={isDeleted ? 'preview-row-deleted' : undefined}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${knowledgeObject.id}:${index}:${cellIndex}`}>
                        {isEditing && !isDeleted && cellIndex !== lookupIdIndex ? (
                          <input
                            className="search-input preview-cell-input"
                            aria-label={`${preview.lookup.fields[cellIndex]} for row ${String(row[lookupIdIndex])}`}
                            value={lookupDraft[index]?.[cellIndex] ?? ''}
                            disabled={isSaving}
                            onChange={(event) => {
                              const value = event.target.value;
                              setIsConfirming(false);
                              setLookupDraft((current) =>
                                current.map((draftRow, draftIndex) =>
                                  draftIndex === index
                                    ? draftRow.map((draftCell, draftCellIndex) => (draftCellIndex === cellIndex ? value : draftCell))
                                    : draftRow,
                                ),
                              );
                            }}
                          />
                        ) : (
                          String(cell)
                        )}
                      </td>
                    ))}
                    {isEditing ? (
                      <td>
                        <button
                          type="button"
                          className="pill pill-subtle"
                          disabled={isSaving}
                          onClick={() => {
                            setIsConfirming(false);
                            setDeletedRowIndexes((current) =>
                              current.includes(index) ? current.filter((candidate) => candidate !== index) : [...current, index],
                            );
                          }}
                        >
                          {isDeleted ? 'Undo delete' : 'Delete'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  );
                })}
                {isEditing
                  ? newLookupRows.map((row, rowIndex) => (
                      <tr key={`${knowledgeObject.id}:new:${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${knowledgeObject.id}:new:${rowIndex}:${cellIndex}`}>
                            {cellIndex === lookupIdIndex ? (
                              'new'
                            ) : (
                              <input
                                className="search-input preview-cell-input"
                                aria-label={`${preview.lookup.fields[cellIndex]} for new row ${rowIndex + 1}`}
                                value={cell}
                                disabled={isSaving}
                                onChange={(event) => updateNewLookupCell(rowIndex, cellIndex, event.target.value)}
                              />
                            )}
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="pill pill-subtle"
                            disabled={isSaving}
                            onClick={() => {
                              setIsConfirming(false);
                              setNewLookupRows((current) => current.filter((_, index) => index !== rowIndex));
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
          {isEditing ? (
            <div className="pill-row">
              <button
                type="button"
                className="pill"
                disabled={isSaving}
                onClick={() => {
                  setIsConfirming(false);
                  setNewLookupRows((current) => [...current, preview.lookup.fields.map(() => '')]);
                }}
              >
                Add row
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {!loading && !error && isEditing && preview && preview.kind !== 'lookup' ? (
        <div className="preview-card">
          <label>
            <Text variant="body-xs-semibold" color="secondary">
              {`${preview.kind.charAt(0).toUpperCase()}${preview.kind.slice(1)} definition (JSON)`}
            </Text>
            <textarea
              className="search-input preview-code-editor"
              value={jsonDraft}
              disabled={isSaving}
              spellCheck={false}
              rows={Math.min(Math.max(jsonDraft.split('\n').length, 8), 30)}
              onChange={(event) => {
                setJsonDraft(event.target.value);
                setIsConfirming(false);
              }}
            />
          </label>
        </div>
      ) : null}
      {!loading && !error && !isEditing && preview?.kind === 'pipeline' ? (
        <div className="preview-card">
          <pre className="preview-code">{JSON.stringify(preview.pipeline.definition, null, 2)}</pre>
        </div>
      ) : null}
      {!loading && !error && !isEditing && (preview?.kind === 'source' || preview?.kind === 'destination') ? (
        <div className="preview-card">
          <pre className="preview-code">{JSON.stringify(preview.definition, null, 2)}</pre>
        </div>
      ) : null}
      {!loading && !error && !isEditing && preview?.kind === 'route' ? (
        <div className="preview-card">
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              Route {preview.route.name} in table {preview.route.tableId}
            </Text>
          </div>
          <div className="preview-table-wrap">
            <table className="preview-table">
              <tbody>
                <tr><th>Id</th><td>{preview.route.id}</td></tr>
                <tr><th>Name</th><td>{preview.route.name}</td></tr>
                <tr><th>Pipeline</th><td>{preview.route.pipeline ?? '—'}</td></tr>
                <tr><th>Output</th><td>{preview.route.output ?? '—'}</td></tr>
                <tr><th>Filter</th><td>{preview.route.filter ?? '—'}</td></tr>
                <tr><th>Final</th><td>{String(preview.route.final ?? '—')}</td></tr>
                <tr><th>Disabled</th><td>{String(preview.route.disabled ?? '—')}</td></tr>
                <tr><th>Description</th><td>{preview.route.description ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {!loading && !error && preview === null ? (
        <div className="preview-card">
          <Text variant="body-sm-normal" color="secondary">
            Preview is available for lookups, pipelines, routes, sources, and destinations.
          </Text>
        </div>
      ) : null}
    </div>
  );
}
