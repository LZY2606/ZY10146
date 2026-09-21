import {
  type ChildSlot,
  type MutableNodeStructureAdapter,
  type NodeKindRecord,
  type SlotMutation,
  assertNever,
} from '@ts-graphviz/common/internal/traversal';
import type { ASTNode } from '../types.js';
import {
  type ASTClassifiedNode,
  type ASTNodeKind,
  classifyASTNode,
} from './ast-nodes.js';

/**
 * Stable child-slot descriptors for AST nodes.
 *
 * Slot names capture structural positions that must stay distinguishable:
 *
 * - `children`: statement/attribute child arrays (Dot/Graph/Subgraph/
 *   AttributeList/Node/Edge).
 * - `id`, `key`, `value`, `port`, `compass`: single-property literal slots.
 * - `targets`: the ordered edge target tuple (NodeRef / NodeRefGroup, the
 *   latter being a structurally different container whose children are
 *   NodeRefs).
 *
 * @internal
 */
const arraySlot = (name: string): ChildSlot => ({
  name,
  container: 'array',
  index: 0,
});
const propertySlot = (name: string, key: string): ChildSlot => ({
  name,
  container: 'property',
  index: 0,
  key,
});

/**
 * Child slots of every AST kind in stable traversal order. This record is
 * type-complete: adding a new AST kind forces an entry here.
 *
 * @internal
 */
export const astSlotBuilders = {
  Literal: () => [] as const,
  Dot: () => [arraySlot('children')] as const,
  Graph: () =>
    [propertySlot('id', 'id'), arraySlot('children')] as const,
  Attribute: () =>
    [
      propertySlot('key', 'key'),
      propertySlot('value', 'value'),
    ] as const,
  Comment: () => [] as const,
  AttributeList: () => [arraySlot('children')] as const,
  NodeRef: () =>
    [
      propertySlot('id', 'id'),
      propertySlot('port', 'port'),
      propertySlot('compass', 'compass'),
    ] as const,
  NodeRefGroup: () => [arraySlot('children')] as const,
  Edge: () =>
    [arraySlot('targets'), arraySlot('children')] as const,
  Node: () =>
    [propertySlot('id', 'id'), arraySlot('children')] as const,
  Subgraph: () =>
    [propertySlot('id', 'id'), arraySlot('children')] as const,
} satisfies NodeKindRecord<ASTNodeKind, () => readonly ChildSlot[]>;

function readArraySlot(parent: ASTNode, name: string): unknown[] | undefined {
  switch (name) {
    case 'children':
      return (
        parent as
          | { children?: unknown[] }
      ).children as unknown[] | undefined;
    case 'targets':
      return (parent as { targets?: unknown[] }).targets;
    default:
      return undefined;
  }
}

function readPropertySlot(parent: ASTNode, key: PropertyKey): unknown {
  return (parent as unknown as Record<PropertyKey, unknown>)[key];
}

/**
 * Mutable adapter that projects AST nodes onto the internal visitor protocol.
 *
 * @internal
 */
export const astNodeAdapter: MutableNodeStructureAdapter<
  ASTClassifiedNode,
  ASTNodeKind
> = {
  classify(node: unknown): ASTClassifiedNode {
    return classifyASTNode(node as ASTNode);
  },

  slots(node: ASTClassifiedNode): readonly ChildSlot[] {
    return astSlotBuilders[node.kind]();
  },

  read(parent: unknown, slot: ChildSlot): unknown {
    const node = parent as ASTNode;
    if (slot.container === 'property') {
      return readPropertySlot(node, slot.key ?? slot.name);
    }
    const arr = readArraySlot(node, slot.name);
    if (!arr) return undefined;
    return arr[slot.index];
  },

  mutate(parent: unknown, slot: ChildSlot, mutation: SlotMutation): void {
    const node = parent as ASTNode;
    if (slot.container === 'property') {
      const key = String(slot.key ?? slot.name);
      applyProperty(node, key, mutation);
      return;
    }
    const arr = readArraySlot(node, slot.name);
    if (!arr) {
      throw new Error(`AST node has no array child slot "${slot.name}".`);
    }
    applyArray(arr, slot.index, mutation);
  },
};

function applyArray(
  arr: unknown[],
  index: number,
  mutation: SlotMutation,
): void {
  switch (mutation.type) {
    case 'remove':
      arr.splice(index, 1);
      return;
    case 'replace':
      arr.splice(index, 1, ...(mutation.nodes as unknown[]));
      return;
    case 'insert':
      arr.splice(
        index + (mutation.position === 'after' ? 1 : 0),
        0,
        ...(mutation.nodes as unknown[]),
      );
      return;
    default:
      assertNever(mutation);
  }
}

function applyProperty(
  node: ASTNode,
  key: string,
  mutation: SlotMutation,
): void {
  const target = node as unknown as Record<string, unknown>;
  switch (mutation.type) {
    case 'remove':
      target[key] = undefined;
      return;
    case 'replace':
      if (mutation.nodes.length !== 1) {
        throw new Error('Property slots accept exactly one replacement node.');
      }
      target[key] = mutation.nodes[0];
      return;
    case 'insert':
      throw new Error(
        'insertBefore/insertAfter are not supported on property child slots.',
      );
    default:
      assertNever(mutation);
  }
}
