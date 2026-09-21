import type {
  DotObjectModel,
  EdgeTarget,
  GraphBaseModel,
  NodeRef,
  NodeRefGroup,
} from '@ts-graphviz/common';
import {
  isAttributeListModel,
  isEdgeModel,
  isNodeModel,
  isRootGraphModel,
  isSubgraphModel,
  type NodeAdapter,
  type NodeLocation,
  type NodeSlot,
  type TransformAction,
  TransformNotSupportedError,
  type TraversalKind,
} from '@ts-graphviz/common';
import type { ModelTraversalNode } from './model-nodes.js';
import {
  type AttributeContainer,
  ModelAttribute,
  ModelComment,
  ModelEdgeTarget,
} from './model-nodes.js';

export type { ModelTraversalNode };

type Slot = NodeSlot<ModelTraversalNode>;

/**
 * {@link NodeAdapter} for the OO model layer.
 *
 * It maps the real graph model (ordered attribute maps, separated node/edge/
 * subgraph collections, string comments, plain edge-target tuples) onto the
 * shared traversal protocol. The model representation is not forced into the
 * AST shape.
 *
 * @group Model Traversal
 */
export const modelNodeAdapter: NodeAdapter<ModelTraversalNode> = {
  kindOf(node) {
    return modelKind(node);
  },
  slotsOf(node) {
    return modelSlots(node);
  },
  applyAction(node, location, action) {
    applyModelAction(node, location, action);
  },
};

/**
 * Exhaustive classification of model traversal nodes.
 *
 * @group Model Traversal
 */
export function modelKind(node: ModelTraversalNode): TraversalKind {
  if (node instanceof ModelComment) {
    return 'Comment';
  }
  if (node instanceof ModelAttribute) {
    return 'Attribute';
  }
  if (node instanceof ModelEdgeTarget) {
    return 'EdgeTarget';
  }
  // Model instances expose a single discriminant property, which is faster
  // than a chain of structural type guards.
  const type = (node as DotObjectModel).$$type;
  switch (type) {
    case 'Graph':
      return 'Graph';
    case 'Subgraph':
      return 'Subgraph';
    case 'Node':
      return 'Node';
    case 'Edge':
      return 'Edge';
    case 'AttributeList':
      return 'AttributeList';
    default: {
      const exhaustive: never = type;
      throw new Error(
        `Unclassified model traversal node type: ${String(exhaustive)}`,
      );
    }
  }
}

function commentSlot(key: string, owner: { comment?: string }): Slot[] {
  return owner.comment === undefined
    ? []
    : [
        {
          key,
          nodes: [new ModelComment(owner.comment, owner)],
          multiple: false,
          mutable: false,
        },
      ];
}

function attributeSlots(key: string, owner: AttributeContainer): Slot[] {
  return owner.size === 0
    ? []
    : [
        {
          key,
          nodes: owner.values.map(([k, v]) => new ModelAttribute(k, v, owner)),
          multiple: true,
          mutable: true,
        },
      ];
}

/**
 * Ordered child slots for a model traversal node.
 *
 * Graph-like ordering mirrors the exact model-to-AST emission order:
 * direct assignments → default attribute lists (graph/edge/node) → nodes →
 * subgraphs → edges, each preceded by its attached comment.
 *
 * @group Model Traversal
 */
export function modelSlots(node: ModelTraversalNode): Slot[] {
  if (node instanceof ModelComment || node instanceof ModelEdgeTarget) {
    return [];
  }
  if (node instanceof ModelAttribute) {
    return [];
  }

  if (isRootGraphModel(node) || isSubgraphModel(node)) {
    const graph = node as GraphBaseModel;
    const slots: Slot[] = [
      ...commentSlot('comment', graph),
      ...attributeSlots('assignments', graph),
    ];
    for (const kind of ['graph', 'edge', 'node'] as const) {
      const list = graph.attributes[kind];
      if (list.size > 0 || list.comment !== undefined) {
        slots.push({
          key: `default:${kind}`,
          nodes: [list as unknown as ModelTraversalNode],
          multiple: false,
          mutable: false,
        });
      }
    }
    slots.push({
      key: 'nodes',
      nodes: [...graph.nodes] as ModelTraversalNode[],
      multiple: true,
      mutable: true,
    });
    slots.push({
      key: 'subgraphs',
      nodes: [...graph.subgraphs] as ModelTraversalNode[],
      multiple: true,
      mutable: true,
    });
    slots.push({
      key: 'edges',
      nodes: [...graph.edges] as ModelTraversalNode[],
      multiple: true,
      mutable: true,
    });
    return slots;
  }

  if (isAttributeListModel(node)) {
    return [
      ...commentSlot('comment', node),
      ...attributeSlots('assignments', node),
    ];
  }

  if (isNodeModel(node)) {
    return [
      ...commentSlot('comment', node),
      ...commentSlot('attributesComment', node.attributes),
      ...attributeSlots('assignments', node.attributes),
    ];
  }

  if (isEdgeModel(node)) {
    const targets: ModelTraversalNode[] = node.targets.map(
      (target, index) => new ModelEdgeTarget(target, index),
    );
    return [
      ...commentSlot('comment', node),
      { key: 'targets', nodes: targets, multiple: true, mutable: false },
      ...commentSlot('attributesComment', node.attributes),
      ...attributeSlots('assignments', node.attributes),
    ];
  }

  const exhaustive: never = node;
  throw new Error(
    `No slot mapping for model node: ${String(exhaustive as unknown)}`,
  );
}

function applyModelAction(
  node: ModelTraversalNode,
  location: NodeLocation<ModelTraversalNode>,
  action: TransformAction<ModelTraversalNode>,
): void {
  if (location.parent === undefined) {
    applyRootModelAction(node, action);
    return;
  }

  if (node instanceof ModelComment) {
    throw new TransformNotSupportedError(
      'Model comments are attached scalar strings; clear the owner.comment property instead.',
      'Comment',
    );
  }

  if (node instanceof ModelEdgeTarget) {
    throw new TransformNotSupportedError(
      'Edge targets are immutable endpoint descriptors.',
      'EdgeTarget',
    );
  }

  if (node instanceof ModelAttribute) {
    applyAttributeAction(node, action);
    return;
  }

  applyGraphChildAction(node, location, action);
}

function applyAttributeAction(
  node: ModelAttribute,
  action: TransformAction<ModelTraversalNode>,
): void {
  const owner = node.owner;
  if (action.type === 'insert') {
    throw new TransformNotSupportedError(
      'Cannot insert siblings next to an attribute entry in the ordered map.',
      'Attribute',
    );
  }
  if (action.type === 'delete') {
    owner.delete(node.key);
    return;
  }
  const replacements = action.nodes;
  if (
    replacements.length !== 1 ||
    !(replacements[0] instanceof ModelAttribute)
  ) {
    throw new TransformNotSupportedError(
      'An attribute entry can only be replaced by another attribute entry.',
      'Attribute',
    );
  }
  const next = replacements[0] as ModelAttribute;
  owner.delete(node.key);
  owner.set(next.key, next.value);
}

function applyGraphChildAction(
  node: ModelTraversalNode,
  location: NodeLocation<ModelTraversalNode>,
  action: TransformAction<ModelTraversalNode>,
): void {
  const parent = location.parent;
  if (!isGraphLike(parent)) {
    throw new TransformNotSupportedError(
      `Cannot edit model slot "${location.slot ?? ''}".`,
    );
  }
  const graphParent = parent as unknown as GraphBaseModel;

  if (action.type === 'insert') {
    if (action.position !== 'after' && action.position !== 'before') {
      throw new TransformNotSupportedError('Unsupported insert position.');
    }
    for (const candidate of action.nodes) {
      insertModelChild(graphParent, location.slot, candidate);
    }
    return;
  }

  if (action.type === 'delete') {
    removeModelChild(graphParent, node);
    return;
  }

  removeModelChild(graphParent, node);
  for (const candidate of action.nodes) {
    insertModelChild(graphParent, location.slot, candidate);
  }
}

function isGraphLike(node: ModelTraversalNode | undefined): boolean {
  if (!node) {
    return false;
  }
  const candidate = node as unknown as DotObjectModel;
  return Boolean(isRootGraphModel(candidate) || isSubgraphModel(candidate));
}

function removeModelChild(
  parent: GraphBaseModel,
  node: ModelTraversalNode,
): void {
  if (isNodeModel(node)) {
    parent.removeNode(node);
    return;
  }
  if (isEdgeModel(node)) {
    parent.removeEdge(node);
    return;
  }
  if (isSubgraphModel(node)) {
    parent.removeSubgraph(node);
    return;
  }
  throw new TransformNotSupportedError(
    `Model node kind "${modelKind(node)}" cannot be removed from a graph.`,
    modelKind(node),
  );
}

function insertModelChild(
  parent: GraphBaseModel,
  slot: string | undefined,
  node: ModelTraversalNode,
): void {
  if (isNodeModel(node)) {
    parent.addNode(node);
    return;
  }
  if (isEdgeModel(node)) {
    parent.addEdge(node);
    return;
  }
  if (isSubgraphModel(node)) {
    parent.addSubgraph(node);
    return;
  }
  void slot;
  throw new TransformNotSupportedError(
    `Model node kind "${modelKind(node)}" cannot be inserted into a graph.`,
    modelKind(node),
  );
}

function applyRootModelAction(
  node: ModelTraversalNode,
  action: TransformAction<ModelTraversalNode>,
): void {
  if (action.type === 'insert') {
    throw new TransformNotSupportedError(
      'Cannot insert siblings of the model traversal root.',
      modelKind(node),
    );
  }
  if (action.type === 'delete') {
    throw new TransformNotSupportedError(
      'Cannot delete the model traversal root.',
      modelKind(node),
    );
  }
  if (
    action.nodes.length !== 1 ||
    !isRootGraphModel(action.nodes[0] as DotObjectModel)
  ) {
    throw new TransformNotSupportedError(
      'The model traversal root can only be replaced by another root graph.',
      modelKind(node),
    );
  }
}

/**
 * Normalize an edge target into descriptors used while building edge AST
 * endpoints. Re-exported for converters sharing the traversal protocol.
 *
 * @group Model Traversal
 */
export function describeEdgeTarget(
  target: EdgeTarget,
): { kind: 'ref'; ref: NodeRef } | { kind: 'group'; refs: NodeRefGroup } {
  if (Array.isArray(target)) {
    return { kind: 'group', refs: target as NodeRefGroup };
  }
  return { kind: 'ref', ref: target as NodeRef };
}
