/**
 * Internal, representation-agnostic tree traversal protocol shared by the AST
 * and model layers.
 *
 * The protocol intentionally knows nothing about the concrete shape of nodes.
 * Each package supplies an {@link NodeAdapter} that describes how its own data
 * structures map onto a small, exhaustively classified set of node kinds.
 *
 * @module
 * @group Traversal
 * @internal
 */

/**
 * Classification of every traversable node kind.
 *
 * Elements that merely look similar stay distinct kinds:
 *
 * - `Attribute` is a single key/value assignment (`label = "x"`).
 * - `AttributeList` is a default-attribute statement (`node [...]`).
 * - `Comment` is a standalone comment.
 * - `NodeRef` / `NodeRefGroup` / `AnonymousCluster` describe edge endpoints;
 *   they are never statements of a graph.
 *
 * Adapters switch over this closed union, so adding a kind forces every
 * adapter to handle the new case at compile time.
 *
 * @group Traversal
 */
export type TraversalKind =
  | 'Document'
  | 'Graph'
  | 'Subgraph'
  | 'Node'
  | 'Edge'
  | 'AttributeList'
  | 'Attribute'
  | 'Comment'
  | 'Literal'
  | 'NodeRef'
  | 'NodeRefGroup'
  | 'EdgeTarget'
  | 'AnonymousCluster';

/**
 * A single, stable, named position within a node.
 *
 * A slot contains either one optional child (`multiple: false`) or an ordered
 * list of children (`multiple: true`). Slot order defines the stable child
 * traversal order of a representation.
 *
 * For mutable multiple slots, {@link NodeSlot.nodes} must be the live array
 * backing the node; the walker mutates it through the adapter and keeps
 * iterating the same array, which guarantees stable indexes.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface NodeSlot<N> {
  /** Stable identifier of the slot, unique within a node kind. */
  readonly key: string;
  /** Ordered children of the slot; live array for mutable multiple slots. */
  readonly nodes: ReadonlyArray<N>;
  /** `true` for ordered collections, `false` for single-value slots. */
  readonly multiple: boolean;
  /**
   * Whether structural edits are allowed in the slot.
   *
   * Scalar positions (for example the `id` literal of a node) are never
   * mutable: in-place replacement of the single child is allowed, but deletion
   * or sibling insertion is not.
   */
  readonly mutable: boolean;
}

/**
 * Location of a node inside its parent. `index` is `-1` for scalar slots and
 * for the traversal root.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface NodeLocation<N> {
  readonly parent: N | undefined;
  readonly slot: string | undefined;
  readonly index: number;
}

/**
 * Path entry exposed to visitors.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface VisitPathEntry<N> {
  node: N;
  kind: TraversalKind;
  slot: string | undefined;
  index: number;
}

/**
 * Context handed to visitor callbacks for every enter/leave event.
 *
 * The path is a fresh array for each callback and may be retained by the
 * visitor; its node references stay valid unless the visitor mutates the tree.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface VisitContext<N> {
  /** The current node. */
  readonly node: N;
  /** Exhaustive classification of the current node. */
  readonly kind: TraversalKind;
  /** Ancestor chain, ordered from the traversal root to the current node. */
  readonly path: ReadonlyArray<VisitPathEntry<N>>;
  /** Parent node, or `undefined` for the traversal root. */
  readonly parent: N | undefined;
  /** Name of the slot owning the node in its parent. */
  readonly slot: string | undefined;
  /** Index within the owning slot (`-1` for scalar slots and the root). */
  readonly index: number;
  /** Skip visiting the children of the current node. */
  skipChildren(): void;
  /** Stop the whole traversal once the current callback returns. */
  stop(): void;
}

/**
 * Decision returned by an enter callback.
 *
 * - `undefined` / `true` / {@link CONTINUE}: keep visiting.
 * - `false` / {@link SKIP}: do not descend into the current node's children.
 * - {@link STOP}: terminate the traversal.
 *
 * @group Traversal
 */
export type EnterResult = boolean | symbol | void;

/**
 * Read-only visitor. Every callback is optional; a visitor never mutates the
 * traversed tree.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface Visitor<N> {
  enter?(context: VisitContext<N>): EnterResult;
  leave?(context: VisitContext<N>): void;
}

/**
 * Remove the current node from its parent collection.
 *
 * Deleting a scalar-slot child or the traversal root is not supported and
 * makes the adapter throw a {@link TransformNotSupportedError}.
 *
 * @group Traversal
 */
export interface DeleteAction {
  readonly type: 'delete';
}

/**
 * Replace the current node.
 *
 * - In a collection slot, `nodes` may contain zero, one or many replacements.
 * - In a scalar slot, exactly one node is allowed.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface ReplaceAction<N> {
  readonly type: 'replace';
  readonly nodes: ReadonlyArray<N>;
}

/**
 * Insert siblings next to the current node inside its collection slot.
 *
 * Inserted nodes are visited by the walker exactly once, in order, at the
 * insertion position. Insertion into scalar slots is not supported.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface InsertAction<N> {
  readonly type: 'insert';
  readonly position: 'before' | 'after';
  readonly nodes: ReadonlyArray<N>;
}

/**
 * Structural transform instructions supported by transforming visitors.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export type TransformAction<N> =
  | DeleteAction
  | ReplaceAction<N>
  | InsertAction<N>;

/**
 * Context handed to transforming visitors. Calling more than one mutation per
 * node visit throws.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface TransformContext<N> extends VisitContext<N> {
  delete(): void;
  replace(...nodes: N[]): void;
  insertBefore(...nodes: N[]): void;
  insertAfter(...nodes: N[]): void;
}

/**
 * Visitor that may restructure the traversed tree.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface TransformingVisitor<N> {
  enter?(context: TransformContext<N>): EnterResult;
  leave?(context: TransformContext<N>): void;
}

/**
 * Adapter mapping one concrete representation onto the shared protocol.
 *
 * Implementations live next to the representation they describe, keeping the
 * dependency graph acyclic: `core` never imports `ast`.
 *
 * @typeParam N Concrete node type of the adapted representation.
 * @group Traversal
 */
export interface NodeAdapter<N> {
  /** Classify a node. Must be total over the adapter's node union. */
  kindOf(node: N): TraversalKind;
  /** Return a node's children as ordered, named slots. */
  slotsOf(node: N): ReadonlyArray<NodeSlot<N>>;
  /**
   * Apply a structural transform.
   *
   * Implementations throw a {@link TransformNotSupportedError} when an action
   * cannot be represented in their data model (for example deleting a scalar
   * `id` literal).
   */
  applyAction(
    node: N,
    location: NodeLocation<N>,
    action: TransformAction<N>,
  ): void;
}

/**
 * Error thrown when a transform cannot be represented by an adapter.
 *
 * @group Traversal
 */
export class TransformNotSupportedError extends Error {
  constructor(
    message: string,
    public readonly kind: TraversalKind | undefined = undefined,
  ) {
    super(message);
    this.name = 'TransformNotSupportedError';
  }
}

/**
 * Continue traversal (default enter result).
 * @group Traversal
 */
export const CONTINUE: unique symbol = Symbol('traversal.continue');
/**
 * Skip the current node's children.
 * @group Traversal
 */
export const SKIP: unique symbol = Symbol('traversal.skip');
/**
 * Stop the whole traversal.
 * @group Traversal
 */
export const STOP: unique symbol = Symbol('traversal.stop');
