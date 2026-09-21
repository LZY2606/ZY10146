/**
 * Internal visitor protocol shared by the AST layer and the model layer.
 *
 * The protocol is intentionally side-agnostic: it knows nothing about
 * {@link https://www.npmjs.com/package/@ts-graphviz/ast | @ts-graphviz/ast}
 * node shapes or core model classes. Each side provides a
 * {@link MutableNodeStructureAdapter} that describes its node kinds and child
 * slots.
 *
 * @internal
 */

/**
 * A node as seen by the generic walker: the adapter projects every concrete
 * node into this tagged shape.
 */
export interface ClassifiedNode<Kind extends PropertyKey> {
  /** Discriminated node kind. Adding a new kind must be handled exhaustively. */
  readonly kind: Kind;
  /** The original node, kept by reference so visitors retain the real type. */
  readonly node: unknown;
}

/**
 * What kind of container a child slot is.
 *
 * - `array`: an ordered list of siblings (supports sibling transforms).
 * - `property`: a single optional child, addressed by property key.
 */
export type SlotContainerKind = 'array' | 'property';

/**
 * Location of one child inside its parent.
 */
export interface ChildSlot {
  /**
   * Stable identifier of the slot within a node kind.
   *
   * Slot names are part of the protocol: visitors use them to tell apart
   * structural positions (e.g. an edge `targets` entry versus an attribute
   * list child) without flattening distinct node kinds into one shape full of
   * optional fields.
   */
  readonly name: string;
  /** Whether the slot is an array or a single property. */
  readonly container: SlotContainerKind;
  /** Index within an array slot, or `0` for property slots. */
  readonly index: number;
  /** Property key used when {@link ChildSlot.container} is `property`. */
  readonly key?: PropertyKey;
}

/**
 * One entry of the parent path handed to visitors.
 */
export interface VisitPathEntry<Kind extends PropertyKey>
  extends ClassifiedNode<Kind> {
  /** Slot through which this node is attached to its parent. */
  readonly slot: ChildSlot | null;
}

/**
 * Read-only view passed to `enter`/`leave` visitors.
 */
export interface VisitContext<Kind extends PropertyKey>
  extends ClassifiedNode<Kind> {
  /** Slot through which the current node is attached (`null` at the root). */
  readonly slot: ChildSlot | null;
  /** Node the traversal started from. */
  readonly root: ClassifiedNode<Kind>;
  /**
   * Path from the root to the current node, root first.
   * The last element is the current node.
   */
  readonly path: readonly VisitPathEntry<Kind>[];
  /** Current path entry. */
  readonly current: VisitPathEntry<Kind>;
  /** Parent entry, or `null` at the root. */
  readonly parent: VisitPathEntry<Kind> | null;
  /** Depth of the current node (`0` at the root). */
  readonly depth: number;
}

/**
 * Whether freshly inserted/replaced nodes should themselves be visited.
 *
 * Defaults to `'visit'`. New nodes are visited at most once per insert
 * operation and the original node is never visited twice, so insert-heavy
 * transforms cannot cause infinite traversal loops on their own.
 */
export interface VisitInsertOptions {
  visit?: 'visit' | 'skip';
}

/**
 * Editable view passed to `enter`/`leave` visitors when transforming.
 *
 * Edit rules:
 *
 * - {@link TransformVisitContext.remove} deletes the current node. When called
 *   from `enter`, its children are skipped. `leave` is never called for a
 *   removed node.
 * - {@link TransformVisitContext.replaceWith} replaces the current node with
 *   one or more nodes (same slot). Property slots accept exactly one node.
 *   Replacement nodes at the current position are visited by default; pass
 *   `{ visit: 'skip' }` to skip them. The original node is never visited
 *   again.
 * - {@link TransformVisitContext.insertBefore} /
 *   {@link TransformVisitContext.insertAfter} add siblings around the current
 *   node (array slots only). In `enter`, `insertBefore` visits the inserted
 *   siblings first and then the current node subtree; `insertAfter` visits the
 *   current node subtree first and then the inserted siblings. In `leave`,
 *   inserted siblings are not revisited. Either way each inserted node is
 *   visited at most once.
 * - At most one structural edit is allowed per `enter`/`leave`.
 * - All cursor math is computed by the walker against post-edit arrays, so
 *   removed nodes are not revisited and indexes cannot skip.
 */
export interface TransformVisitContext<Kind extends PropertyKey>
  extends VisitContext<Kind> {
  /** Delete the current node. */
  remove(): void;
  /** Replace the current node with one or more nodes. */
  replaceWith(
    nodes: readonly unknown[],
    options?: VisitInsertOptions,
  ): void;
  /** Insert siblings before the current node (array slots only). */
  insertBefore(
    nodes: readonly unknown[],
    options?: VisitInsertOptions,
  ): void;
  /** Insert siblings after the current node (array slots only). */
  insertAfter(
    nodes: readonly unknown[],
    options?: VisitInsertOptions,
  ): void;
}

/** Read-only visitor. Every callback is optional; the default mode is read-only. */
export type Visitor<Kind extends PropertyKey, C extends VisitContext<Kind>> = {
  enter?(context: C): void;
  leave?(context: C): void;
};

/**
 * Structural mutation applied through a slot.
 */
export type SlotMutation =
  | { type: 'remove' }
  | { type: 'replace'; nodes: readonly unknown[] }
  | {
      type: 'insert';
      position: 'before' | 'after';
      nodes: readonly unknown[];
    };

/**
 * Adapter that projects a concrete tree (AST nodes, model objects, ...) onto
 * the protocol.
 */
export interface NodeStructureAdapter<
  Nodes extends ClassifiedNode<Kind>,
  Kind extends PropertyKey,
> {
  /** Project a concrete node to its classified form. */
  classify(node: unknown): Nodes;
  /**
   * Stable child slots of a node in traversal order.
   *
   * Slots must be reported in the order children should be visited. Returning
   * the same array instance for a node across calls is allowed; the walker
   * snapshots it once.
   */
  slots(node: Nodes): readonly ChildSlot[];
  /** Read a child through a slot. */
  read(parent: unknown, slot: ChildSlot): unknown;
}

/**
 * Adapter that can also apply structural mutations.
 *
 * Read-only traversal only requires {@link NodeStructureAdapter}; transform
 * traversal requires this interface. Read-only trees may throw from
 * {@link MutableNodeStructureAdapter.mutate}.
 */
export interface MutableNodeStructureAdapter<
  Nodes extends ClassifiedNode<Kind>,
  Kind extends PropertyKey,
> extends NodeStructureAdapter<Nodes, Kind> {
  /** Apply a structural mutation through a slot. */
  mutate(parent: unknown, slot: ChildSlot, mutation: SlotMutation): void;
}
