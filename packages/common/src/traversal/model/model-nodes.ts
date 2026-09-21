import type {
  AttributeListModel,
  EdgeModel,
  ForwardRefNode,
  NodeModel,
  RootGraphModel,
  SubgraphModel,
} from '../../models.js';

/**
 * Classified, type-complete view of the object model used by the internal
 * visitor protocol.
 *
 * The object model and the AST have genuinely different shapes, so rather
 * than collapsing them into one optional-field union, the model is projected
 * into its own set of kinds:
 *
 * - {@link RootGraphVisitNode} / {@link SubgraphVisitNode}: cluster owners.
 * - {@link NodeVisitNode}, {@link EdgeVisitNode}: graph objects.
 * - {@link AttributeListVisitNode}: the three default attribute groups
 *   (`graph`/`edge`/`node`).
 * - {@link AttributeAssignmentVisitNode}: a single `key = value` on a cluster.
 * - {@link NodeRefVisitNode}: a plain node id target.
 * - {@link ForwardRefVisitNode}: a node id with optional port/compass.
 * - {@link NodeRefGroupVisitNode}: a group target (array of refs).
 * - {@link LeadingCommentVisitNode}: a comment emitted immediately before its
 *   {@link commentOwner} (the model keeps comments on their owners, so they
 *   are projected as virtual sibling nodes for traversal parity).
 *
 * @internal
 */
export type ModelVisitNode =
  | RootGraphVisitNode
  | SubgraphVisitNode
  | NodeVisitNode
  | EdgeVisitNode
  | AttributeListVisitNode
  | AttributeAssignmentVisitNode
  | NodeRefVisitNode
  | ForwardRefVisitNode
  | NodeRefGroupVisitNode
  | LeadingCommentVisitNode;

/** @internal */
export type ModelNodeKind = ModelVisitNode['kind'];

interface VisitBase<Kind extends string> {
  kind: Kind;
  /**
   * Primary underlying model value. For comment/group/assignment nodes this
   * is the virtual node's own payload (kept so the node satisfies the generic
   * classified-node protocol).
   */
  node: unknown;
  /** Owning model node, for traversal back-references. */
  owner: unknown;
}

/** @internal */
export interface RootGraphVisitNode extends VisitBase<'RootGraph'> {
  node: RootGraphModel;
}
/** @internal */
export interface SubgraphVisitNode extends VisitBase<'Subgraph'> {
  node: SubgraphModel;
}
/** @internal */
export interface NodeVisitNode extends VisitBase<'Node'> {
  node: NodeModel;
}
/** @internal */
export interface EdgeVisitNode extends VisitBase<'Edge'> {
  node: EdgeModel;
}
/** @internal */
export interface AttributeListVisitNode
  extends VisitBase<'AttributeList'> {
  node: AttributeListModel;
}
/** @internal */
export interface AttributeAssignmentVisitNode
  extends VisitBase<'AttributeAssignment'> {
  node: { key: string; value: unknown };
  /** Attribute key (typed loosely to stay independent of attribute lists). */
  key: string;
  value: unknown;
}
/** @internal */
export interface NodeRefVisitNode extends VisitBase<'NodeRef'> {
  /** The referenced node model when known. */
  node: NodeModel;
}
/** @internal */
export interface ForwardRefVisitNode extends VisitBase<'ForwardRef'> {
  node: ForwardRefNode;
}
/** @internal */
export interface NodeRefGroupVisitNode
  extends VisitBase<'NodeRefGroup'> {
  node: ReadonlyArray<NodeModel | ForwardRefNode>;
  nodes: ReadonlyArray<NodeModel | ForwardRefNode>;
}
/** @internal */
export interface LeadingCommentVisitNode
  extends VisitBase<'LeadingComment'> {
  node: { value: string };
  value: string;
  /** The model node this comment precedes. */
  commentOwner: unknown;
  /**
   * Where the comment is emitted:
   * - `root`: before the root graph keyword (the root graph's own comment).
   * - `sibling`: immediately before another graph element (node/edge/
   *   subgraph/attribute-list) inside a cluster.
   */
  placement: 'root' | 'sibling';
}
