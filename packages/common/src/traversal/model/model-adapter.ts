import {
  type AttributeListModel,
  type EdgeModel,
  type ForwardRefNode,
  type GraphBaseModel,
  isNodeModel,
  type NodeModel,
  type RootGraphModel,
  type SubgraphModel,
} from '../../models.js';
import type {
  AttributeAssignmentVisitNode,
  EdgeVisitNode,
  LeadingCommentVisitNode,
  ModelNodeKind,
  ModelVisitNode,
  NodeRefGroupVisitNode,
  NodeRefVisitNode,
  NodeVisitNode,
  ForwardRefVisitNode,
  RootGraphVisitNode,
  SubgraphVisitNode,
  AttributeListVisitNode,
} from './model-nodes.js';
import type {
  ChildSlot,
  MutableNodeStructureAdapter,
} from '../protocol-types.js';

/**
 * Read-only model adapter for the internal visitor protocol.
 *
 * The object model stores children on the owner (nodes/edges/subgraphs maps
 * and attribute groups), so the adapter projects a virtual, ordered child
 * list that matches the canonical DOT emission order:
 *
 * 1. direct attribute assignments (`key = value`)
 * 2. non-empty default attribute lists (with a leading comment when present)
 * 3. nodes (leading comment when present)
 * 4. subgraphs (leading comment when present)
 * 5. edges (leading comment when present)
 *
 * This is the single source of ordering shared by from-model conversion and
 * any model analysis tooling.
 *
 * The adapter is read-only: model mutation goes through the model's own
 * object API. {@link mutate} throws.
 *
 * @internal
 */
const clusterChildCache = new WeakMap<object, ModelVisitNode[]>();
const edgeTargetCache = new WeakMap<object, ModelVisitNode[]>();
const groupRefCache = new WeakMap<object, ModelVisitNode[]>();
const attributeListCache = new WeakMap<object, ModelVisitNode[]>();

class ModelStructureAdapter
  implements
    MutableNodeStructureAdapter<ModelVisitNode, ModelNodeKind>
{
  classify(node: unknown): ModelVisitNode {
    if (isModelVisitNode(node)) return node;
    throw new Error(
      `Cannot classify value as a model visit node: ${String(node)}`,
    );
  }

  slots(node: ModelVisitNode): readonly ChildSlot[] {
    switch (node.kind) {
      case 'RootGraph':
      case 'Subgraph':
        return [{ name: 'clusterChildren', container: 'array', index: 0 }];
      case 'Node':
        return [
          { name: 'attributeComment', container: 'property', index: 0, key: 'comment' },
          { name: 'attributes', container: 'array', index: 0 },
        ];
      case 'Edge':
        return [
          { name: 'targets', container: 'array', index: 0 },
          { name: 'attributeComment', container: 'property', index: 0, key: 'comment' },
          { name: 'attributes', container: 'array', index: 0 },
        ];
      case 'NodeRefGroup':
        return [{ name: 'refs', container: 'array', index: 0 }];
      case 'AttributeList':
        return [{ name: 'values', container: 'array', index: 0 }];
      case 'NodeRef':
      case 'ForwardRef':
      case 'AttributeAssignment':
      case 'LeadingComment':
        return [];
      default:
        assertNeverModel(node);
    }
  }

  read(parent: unknown, slot: ChildSlot): unknown {
    const node = parent as ModelVisitNode;
    switch (slot.name) {
      case 'clusterChildren': {
        const cluster = node as RootGraphVisitNode | SubgraphVisitNode;
        let list = clusterChildCache.get(cluster.node);
        if (!list) {
          list = clusterChildren(cluster);
          clusterChildCache.set(cluster.node, list);
        }
        return list[slot.index];
      }
      case 'attributes': {
        const attrs =
          (node as NodeVisitNode | EdgeVisitNode).node.attributes;
        const key = attrs.values[slot.index]?.[0];
        const value = attrs.values[slot.index]?.[1];
        if (key === undefined) return undefined;
        const assignment: AttributeAssignmentVisitNode = {
          kind: 'AttributeAssignment',
          owner: (node as NodeVisitNode | EdgeVisitNode).node,
          node: { key: String(key), value },
          key: String(key),
          value,
        };
        return assignment;
      }
      case 'attributeComment': {
        const group = (node as NodeVisitNode | EdgeVisitNode).node.attributes;
        if (!group.comment) return undefined;
        const comment: LeadingCommentVisitNode = {
          kind: 'LeadingComment',
          value: group.comment,
          node: { value: group.comment },
          owner: (node as NodeVisitNode | EdgeVisitNode).node,
          commentOwner: (node as NodeVisitNode | EdgeVisitNode).node,
          placement: 'sibling',
        };
        return comment;
      }
      case 'targets': {
        const edgeNode = node as EdgeVisitNode;
        let list = edgeTargetCache.get(edgeNode.node);
        if (!list) {
          list = edgeNode.node.targets.map((t) =>
            classifyTarget(t, edgeNode.node),
          );
          edgeTargetCache.set(edgeNode.node, list);
        }
        return list[slot.index];
      }
      case 'refs': {
        const groupNode = node as NodeRefGroupVisitNode;
        let list = groupRefCache.get(groupNode);
        if (!list) {
          list = groupNode.nodes.map((_, idx) => groupRef(groupNode, idx)!).filter(
            (x): x is ModelVisitNode => x !== undefined,
          );
          groupRefCache.set(groupNode, list);
        }
        return list[slot.index];
      }
      case 'values': {
        const listModel = (node as AttributeListVisitNode).node;
        let virtual = attributeListCache.get(listModel);
        if (!virtual) {
          virtual = listModel.values.map(([k, v]) => ({
            kind: 'AttributeAssignment' as const,
            owner: listModel,
            node: { key: String(k), value: v },
            key: String(k),
            value: v,
          }));
          attributeListCache.set(listModel, virtual as ModelVisitNode[]);
        }
        return virtual[slot.index];
      }
      default:
        return undefined;
    }
  }

  mutate(): never {
    throw new Error(
      'The model traversal adapter is read-only; mutate model objects through their API.',
    );
  }
}

function assertNeverModel(value: never): never {
  throw new Error(`Unhandled model visit kind: ${JSON.stringify(value)}`);
}

function groupRef(
  group: NodeRefGroupVisitNode,
  index: number,
): ModelVisitNode | undefined {
  const target = group.nodes[index];
  if (!target) return undefined;
  const owner = group.owner as EdgeModel;
  if (isNodeModel(target)) {
    const ref: NodeRefVisitNode = { kind: 'NodeRef', node: target, owner };
    return ref;
  }
  const forward: ForwardRefVisitNode = {
    kind: 'ForwardRef',
    node: target as ForwardRefNode,
    owner,
  };
  return forward;
}

/** @internal */
export function classifyTarget(
  target: NodeModel | ForwardRefNode | Array<NodeModel | ForwardRefNode>,
  owner: EdgeModel,
): ModelVisitNode {
  if (Array.isArray(target)) {
    const group: NodeRefGroupVisitNode = {
      kind: 'NodeRefGroup',
      node: target,
      nodes: target,
      owner,
    };
    return group;
  }
  if (isNodeModel(target)) {
    const ref: NodeRefVisitNode = { kind: 'NodeRef', node: target, owner };
    return ref;
  }
  const forward: ForwardRefVisitNode = {
    kind: 'ForwardRef',
    node: target,
    owner,
  };
  return forward;
}

function isModelVisitNode(node: unknown): node is ModelVisitNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as { kind?: unknown }).kind === 'string' &&
    typeof (node as { owner?: unknown }).owner !== 'undefined'
  );
}

function leadingComment(
  value: string,
  commentOwner: unknown,
  placement: 'root' | 'sibling' = 'sibling',
): LeadingCommentVisitNode {
  return {
    kind: 'LeadingComment',
    value,
    node: { value },
    owner: commentOwner,
    commentOwner,
    placement,
  };
}

/**
 * Canonical ordered virtual children of a graph/subgraph, matching DOT
 * emission order.
 *
 * @internal
 */
export function clusterChildren(
  cluster: RootGraphVisitNode | SubgraphVisitNode,
): ModelVisitNode[] {
  const model = cluster.node as unknown as RootGraphModel;
  const out: ModelVisitNode[] = [];
  // The root graph's own leading comment precedes every other child (it is
  // emitted before the `graph` keyword). Subgraph comments are emitted by the
  // owning parent (which lists subgraphs), so only the root emits its own.
  if (cluster.kind === 'RootGraph' && model.comment) {
    out.push(leadingComment(model.comment, model, 'root'));
  }
  for (const [key, value] of model.values) {
    out.push({
      kind: 'AttributeAssignment',
      owner: model,
      node: { key: String(key), value },
      key: String(key),
      value,
    });
  }
  for (const list of Object.values(model.attributes) as AttributeListModel[]) {
    if (list.size > 0) {
      if (list.comment) {
        out.push(leadingComment(list.comment, list));
      }
      const listNode: AttributeListVisitNode = {
        kind: 'AttributeList',
        node: list,
        owner: model,
      };
      out.push(listNode);
    }
  }
  for (const node of model.nodes) {
    if (node.comment) out.push(leadingComment(node.comment, node));
    const nodeVisit: NodeVisitNode = { kind: 'Node', node, owner: model };
    out.push(nodeVisit);
  }
  for (const subgraph of model.subgraphs) {
    if (subgraph.comment) out.push(leadingComment(subgraph.comment, subgraph));
    const subVisit: SubgraphVisitNode = {
      kind: 'Subgraph',
      node: subgraph as SubgraphModel,
      owner: model,
    };
    out.push(subVisit);
  }
  for (const edge of model.edges) {
    if (edge.comment) out.push(leadingComment(edge.comment, edge));
    const edgeVisit: EdgeVisitNode = { kind: 'Edge', node: edge, owner: model };
    out.push(edgeVisit);
  }
  return out;
}

/**
 * Classify a root graph model as a traversal entry node.
 *
 * @internal
 */
export function classifyRootGraph(graph: RootGraphModel): RootGraphVisitNode {
  return { kind: 'RootGraph', node: graph, owner: graph };
}

/**
 * Classify any cluster-like graph model: root graphs expose `directed`/
 * `strict`; plain cluster models do not.
 *
 * @internal
 */
export function classifyGraphModel(
  graph: GraphBaseModel,
): RootGraphVisitNode | SubgraphVisitNode {
  if ('directed' in graph) {
    return { kind: 'RootGraph', node: graph as RootGraphModel, owner: graph };
  }
  return {
    kind: 'Subgraph',
    node: graph as SubgraphModel,
    owner: graph,
  };
}

/** @internal */
export const modelNodeAdapter: MutableNodeStructureAdapter<
  ModelVisitNode,
  ModelNodeKind
> = new ModelStructureAdapter();
