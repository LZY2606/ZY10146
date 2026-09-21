import type {
  NodeAdapter,
  NodeLocation,
  NodeSlot,
  TransformAction,
  TraversalKind,
} from '@ts-graphviz/common';
import { TransformNotSupportedError } from '@ts-graphviz/common';
import type {
  ASTNode,
  AttributeASTNode,
  AttributeListASTNode,
  CommentASTNode,
  DotASTNode,
  EdgeASTNode,
  GraphASTNode,
  LiteralASTNode,
  NodeASTNode,
  NodeRefASTNode,
  NodeRefGroupASTNode,
  SubgraphASTNode,
} from '../types.js';

/**
 * Node type of the AST traversal: the full discriminated AST union.
 *
 * @group AST Traversal
 */
export type ASTTraversalNode = ASTNode;


/**
 * {@link NodeAdapter} describing the AST representation.
 *
 * The switch statements here are exhaustive over every concrete AST node
 * type: adding a new `type` to the AST union makes this file fail to compile
 * until the new kind is classified and assigned slots.
 *
 * @group AST Traversal
 */
export const astNodeAdapter: NodeAdapter<ASTTraversalNode> = {
  kindOf(node) {
    return astKind(node);
  },

  slotsOf(node) {
    return astSlots(node);
  },

  applyAction(node, location, action) {
    applyASTAction(node, location, action);
  },
};

/**
 * Exhaustive classification of AST nodes. Every member of the AST node union
 * must appear in this switch.
 *
 * @group AST Traversal
 */
export function astKind(node: ASTTraversalNode): TraversalKind {
  switch (node.type) {
    case 'Literal':
      return 'Literal';
    case 'Dot':
      return 'Document';
    case 'Graph':
      return 'Graph';
    case 'Attribute':
      return 'Attribute';
    case 'Comment':
      return 'Comment';
    case 'AttributeList':
      return 'AttributeList';
    case 'NodeRef':
      return 'NodeRef';
    case 'NodeRefGroup':
      return 'NodeRefGroup';
    case 'Edge':
      return 'Edge';
    case 'Node':
      return 'Node';
    case 'Subgraph':
      return node.id === undefined ? 'AnonymousCluster' : 'Subgraph';
    default: {
      // Compile-time exhaustiveness guard.
      const exhaustive: never = node;
      return exhaustive as never;
    }
  }
}

function scalarSlot(
  key: string,
  node: ASTNode | undefined,
): NodeSlot<ASTTraversalNode>[] {
  return node === undefined
    ? []
    : ([
        { key, nodes: [node], multiple: false, mutable: true },
      ] as NodeSlot<ASTTraversalNode>[]);
}

function listSlot(key: string, nodes: ASTNode[]): NodeSlot<ASTTraversalNode> {
  return { key, nodes, multiple: true, mutable: true };
}

/**
 * Return the ordered, named child slots of an AST node.
 *
 * Scalar named positions (ids, key/value literals, edge endpoints) are kept
 * separate from ordered `children` arrays so that element kinds which are not
 * interchangeable are never collapsed into one optional-field bag.
 *
 * @group AST Traversal
 */
export function astSlots(
  node: ASTTraversalNode,
): ReadonlyArray<NodeSlot<ASTTraversalNode>> {
  switch (node.type) {
    case 'Literal':
    case 'Comment':
      return [];
    case 'Dot':
      return [listSlot('children', node.children as ASTNode[])];
    case 'Graph':
      return [
        ...scalarSlot('id', node.id),
        listSlot('children', node.children as ASTNode[]),
      ];
    case 'Subgraph':
      return [
        ...scalarSlot('id', node.id),
        listSlot('children', node.children as ASTNode[]),
      ];
    case 'Attribute':
      return [
        ...scalarSlot('key', node.key),
        ...scalarSlot('value', node.value),
      ];
    case 'AttributeList':
      return [listSlot('children', node.children as ASTNode[])];
    case 'NodeRef':
      return [
        ...scalarSlot('id', node.id),
        ...scalarSlot('port', node.port),
        ...scalarSlot('compass', node.compass),
      ];
    case 'NodeRefGroup':
      return [listSlot('targets', node.children as ASTNode[])];
    case 'Node':
      return [
        ...scalarSlot('id', node.id),
        listSlot('children', node.children as ASTNode[]),
      ];
    case 'Edge':
      return [
        listSlot('targets', node.targets as unknown as ASTNode[]),
        listSlot('children', node.children as ASTNode[]),
      ];
    default: {
      const exhaustive: never = node;
      throw new Error(
        `No slot mapping for AST node: ${String(exhaustive as unknown)}`,
      );
    }
  }
}

function applyASTAction(
  node: ASTTraversalNode,
  location: NodeLocation<ASTTraversalNode>,
  action: TransformAction<ASTTraversalNode>,
): void {
  if (location.parent === undefined) {
    applyRootAction(node, action);
    return;
  }

  if (location.slot === undefined || location.index < 0) {
    throw new TransformNotSupportedError(
      'Scalar AST slots can only be replaced in place; deleting or inserting is not supported.',
      astKind(node),
    );
  }

  const array = resolveSlotArray(location.parent, location.slot);
  if (!array) {
    throw new TransformNotSupportedError(
      `AST slot "${location.slot}" is not an editable collection.`,
    );
  }
  const currentIndex = array.indexOf(node);
  if (currentIndex < 0) {
    throw new Error('AST node is no longer present in its parent slot.');
  }

  switch (action.type) {
    case 'delete':
      array.splice(currentIndex, 1);
      return;
    case 'replace':
      array.splice(currentIndex, 1, ...(action.nodes as ASTNode[]));
      return;
    case 'insert':
      if (action.position === 'before') {
        array.splice(currentIndex, 0, ...(action.nodes as ASTNode[]));
      } else {
        array.splice(currentIndex + 1, 0, ...(action.nodes as ASTNode[]));
      }
      return;
  }
}

function resolveSlotArray(
  parent: ASTTraversalNode,
  slot: string,
): ASTNode[] | undefined {
  const owner = parent as unknown as Record<string, unknown>;
  const candidate = owner[slot];
  return Array.isArray(candidate) ? (candidate as ASTNode[]) : undefined;
}

function applyRootAction(
  node: ASTTraversalNode,
  action: TransformAction<ASTTraversalNode>,
): void {
  // Root transforms cannot be structurally represented without a container.
  // Replacing the root with exactly one node of the same role is a no-op at
  // the data level (the walker returns the replacement), so allow it; anything
  // else is rejected.
  if (action.type === 'insert') {
    throw new TransformNotSupportedError(
      'Cannot insert siblings of the AST traversal root.',
      astKind(node),
    );
  }
  if (action.type === 'delete') {
    throw new TransformNotSupportedError(
      'Cannot delete the AST traversal root.',
      astKind(node),
    );
  }
  if (action.nodes.length !== 1) {
    throw new TransformNotSupportedError(
      'The AST traversal root can only be replaced by a single node.',
      astKind(node),
    );
  }
}

/**
 * Re-exported concrete node types for typing AST visitors.
 *
 * @group AST Traversal
 */
export type {
  AttributeASTNode,
  AttributeListASTNode,
  CommentASTNode,
  DotASTNode,
  EdgeASTNode,
  GraphASTNode,
  LiteralASTNode,
  NodeASTNode,
  NodeRefASTNode,
  NodeRefGroupASTNode,
  SubgraphASTNode,
};
