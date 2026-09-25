import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Text } from '@capra/core';
import type { KnowledgeObject } from '../types';

const TYPE_ORDER = ['lookup', 'pipeline', 'route'] as const;

function getTypeLabel(type: string): string {
  switch (type) {
    case 'lookup':
      return 'Lookups';
    case 'pipeline':
      return 'Pipelines';
    case 'route':
      return 'Routes';
    default:
      return `${type.charAt(0).toUpperCase()}${type.slice(1)}s`;
  }
}

function sortTypes(left: string, right: string): number {
  const leftIndex = TYPE_ORDER.indexOf(left as (typeof TYPE_ORDER)[number]);
  const rightIndex = TYPE_ORDER.indexOf(right as (typeof TYPE_ORDER)[number]);
  const leftOrder = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const rightOrder = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.localeCompare(right);
}

interface KnowledgeObjectGroupsProps {
  knowledgeObjects: KnowledgeObject[];
  variant?: 'detail' | 'tree';
  selectedKnowledgeObjectKey?: string | null;
  onSelectKnowledgeObject?: (knowledgeObject: KnowledgeObject) => void;
  renderPreview?: (knowledgeObject: KnowledgeObject) => ReactNode;
}

export function KnowledgeObjectGroups({
  knowledgeObjects,
  variant = 'detail',
  selectedKnowledgeObjectKey,
  onSelectKnowledgeObject,
  renderPreview,
}: KnowledgeObjectGroupsProps) {
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byType = new Map<string, KnowledgeObject[]>();

    knowledgeObjects.forEach((knowledgeObject) => {
      const current = byType.get(knowledgeObject.type) ?? [];
      current.push(knowledgeObject);
      byType.set(knowledgeObject.type, current);
    });

    return Array.from(byType.entries())
      .sort(([leftType], [rightType]) => sortTypes(leftType, rightType))
      .map(([type, items]) => ({
        type,
        label: getTypeLabel(type),
        items,
      }));
  }, [knowledgeObjects]);

  const toggleType = (type: string) => {
    const nextExpanded = new Set(expandedTypes);

    if (nextExpanded.has(type)) {
      nextExpanded.delete(type);
    } else {
      nextExpanded.add(type);
    }

    setExpandedTypes(nextExpanded);
  };

  const canPreview = (knowledgeObject: KnowledgeObject) =>
    knowledgeObject.type === 'lookup' || knowledgeObject.type === 'pipeline' || knowledgeObject.type === 'route';

  return (
    <div className="knowledge-group-list">
      {groups.map((group) => {
        const isExpanded = expandedTypes.has(group.type);

        return (
          <div key={group.type} className="tree-node">
            <button
              type="button"
              className={`tree-toggle tree-toggle-compact${isExpanded ? ' tree-toggle-open' : ''}`}
              onClick={() => toggleType(group.type)}
            >
              <span className="tree-caret" aria-hidden="true">
                {isExpanded ? '▼' : '▶'}
              </span>
              <div className="tree-copy">
                <div className="list-card-header">
                  <Text variant={variant === 'tree' ? 'body-sm-semibold' : 'body-md-semibold'}>
                    {group.label}
                  </Text>
                  <span className="pill pill-subtle">{group.items.length}</span>
                </div>
              </div>
            </button>

            {isExpanded ? (
              <div className="tree-children tree-children-leaf knowledge-group-items">
                {group.items.map((knowledgeObject) => {
                  const selectedKey = `${knowledgeObject.type}:${knowledgeObject.id}`;
                  const isSelected = selectedKnowledgeObjectKey === selectedKey;

                  return (
                    <div key={selectedKey}>
                      {variant === 'tree' ? (
                        <button
                          type="button"
                          className={`knowledge-row knowledge-row-button${isSelected ? ' knowledge-row-selected' : ''}`}
                          onClick={() => onSelectKnowledgeObject?.(knowledgeObject)}
                          disabled={!canPreview(knowledgeObject)}
                        >
                          <Text variant="body-xs-normal">{knowledgeObject.name}</Text>
                          <span className="pill pill-subtle">{knowledgeObject.type}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`detail-card knowledge-detail-button${isSelected ? ' knowledge-row-selected' : ''}`}
                          onClick={() => onSelectKnowledgeObject?.(knowledgeObject)}
                          disabled={!canPreview(knowledgeObject)}
                        >
                          <div className="list-card-header">
                            <Text variant="body-md-semibold">{knowledgeObject.name}</Text>
                            <span className="pill pill-subtle">{knowledgeObject.type}</span>
                          </div>
                          {knowledgeObject.description ? (
                            <div className="section-copy">
                              <Text variant="body-sm-normal" color="secondary">
                                {knowledgeObject.description}
                              </Text>
                            </div>
                          ) : null}
                        </button>
                      )}

                      {isSelected && renderPreview ? (
                        <div className="preview-card preview-card-inline">{renderPreview(knowledgeObject)}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}