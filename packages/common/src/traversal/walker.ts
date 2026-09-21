import type {
  EnterResult,
  NodeAdapter,
  NodeLocation,
  NodeSlot,
  TransformContext,
  TransformingVisitor,
  TraversalKind,
  VisitContext,
  Visitor,
  VisitPathEntry,
} from './types.js';
import { CONTINUE, SKIP, STOP, TransformNotSupportedError } from './types.js';

type EnterDecision = typeof CONTINUE | typeof SKIP | typeof STOP;

/**
 * @hidden
 */
interface Frame<N> {
  node: N;
  kind: TraversalKind;
  parent: N | undefined;
  slotKey: string | undefined;
  index: number;
  // Ordered child descriptors for the node, materialized once but resolved
  // lazily through the adapter so backed-by-snapshot collections stay correct
  // after sibling mutations.
  plan: ChildPlan<N>[];
  cursor: number;
  entered: boolean;
  // Whether the node's own subtree traversal has finished entering (set when
  // inserted frames parked above this one have drained).
  phase: 'enter' | 'children' | 'done';
  skipChildren: boolean;
}

/**
 * A planned visit to a child. `resolve` returns the current node for a
 * position; returning undefined means the position disappeared (a delete the
 * adapter already accounted for) and should be skipped.
 *
 * @hidden
 */
interface ChildPlan<N> {
  slot: string;
  multiple: boolean;
  index: number;
  resolve(): { node: N; index: number } | undefined;
}

type PendingAction<N> =
  | { kind: 'delete' }
  | { kind: 'replace'; nodes: ReadonlyArray<N> }
  | { kind: 'insert'; position: 'before' | 'after'; nodes: ReadonlyArray<N> };

interface SettleResult {
  removeFrame?: boolean;
  replaceRoots?: boolean;
  deleteRoot?: boolean;
}

function normalizeResult(result: EnterResult | undefined): EnterDecision {
  if (result === false || result === SKIP) {
    return SKIP;
  }
  if (result === STOP) {
    return STOP;
  }
  return CONTINUE;
}

/**
 * Internal, representation-agnostic depth-first walker.
 *
 * The walker owns one explicit frame stack, so traversal depth never grows the
 * JavaScript call stack. Representation-specific behavior lives in the
 * supplied {@link NodeAdapter}.
 *
 * Mutation semantics for collection (`multiple: true`, `mutable: true`) slots:
 *
 * - `delete` removes the current node; descendants and `leave` never run and
 *   traversal continues at the following sibling without skipping it.
 * - `replace(nodes)` swaps the current node for zero or many nodes which are
 *   entered immediately, in order.
 * - `insertBefore(nodes)` / `insertAfter(nodes)` inserts siblings visited
 *   exactly once, in order; the current node is never visited twice and later
 *   siblings are never skipped.
 *
 * Child positions are resolved through the adapter at visit time, which makes
 * the walker correct for both live-array trees (AST) and snapshot/map-backed
 * trees (the OO model). Frames are transient, so a throwing callback cannot
 * leave any shared parent stack behind.
 *
 * @group Traversal
 * @internal
 */
export class TreeWalker<N> {
  constructor(private readonly adapter: NodeAdapter<N>) {}

  public visit(root: N, visitor: Visitor<N>): void {
    this.walk(root, visitor, false);
  }

  /**
   * Walk `root` with structural edits enabled. Returns the (possibly
   * replaced) first root, or `undefined` when the root was deleted.
   */
  public transform(root: N, visitor: TransformingVisitor<N>): N | undefined {
    return this.walk(root, visitor, true);
  }

  private walk(
    initialRoot: N,
    visitor: Visitor<N>,
    transforming: boolean,
  ): N | undefined {
    const roots: N[] = [initialRoot];
    let rootIndex = 0;
    let halted = false;

    while (rootIndex < roots.length && !halted) {
      const frames: Frame<N>[] = [
        this.createFrame(roots[rootIndex], undefined, undefined, -1),
      ];

      while (frames.length > 0) {
        const frame = frames[frames.length - 1];

        if (frame.phase === 'enter') {
          frame.entered = true;
          frame.phase = 'children';
          const entered = this.invokeEnter(
            frame,
            frames,
            visitor,
            transforming,
          );
          if (entered.stop) {
            halted = true;
            break;
          }
          if (entered.skip) {
            frame.skipChildren = true;
          }
          if (entered.pending !== undefined) {
            const settle = this.settleMutation(
              frame,
              frames,
              roots,
              rootIndex,
              entered.pending,
            );
            if (settle?.deleteRoot) {
              return undefined;
            }
            if (settle?.replaceRoots) {
              rootIndex = -1;
              break;
            }
            if (settle?.removeFrame) {
              frames.pop();
              continue;
            }
          }
          if (frame.skipChildren) {
            this.callLeave(frame, frames, visitor);
            frames.pop();
          }
          continue;
        }

        const child = this.nextPlannedChild(frame);
        if (child === undefined) {
          this.callLeave(frame, frames, visitor);
          frames.pop();
          continue;
        }
        frames.push(
          this.createFrame(
            child.node,
            frame.node,
            child.slot,
            child.multiple ? child.index : -1,
          ),
        );
      }

      rootIndex += 1;
    }

    return roots[0];
  }

  private createFrame(
    node: N,
    parent: N | undefined,
    slotKey: string | undefined,
    index: number,
  ): Frame<N> {
    return {
      node,
      kind: this.adapter.kindOf(node),
      parent,
      slotKey,
      index,
      plan: undefined as unknown as ChildPlan<N>[],
      cursor: 0,
      entered: false,
      phase: 'enter',
      skipChildren: false,
    };
  }

  /**
   * Build the ordered child plan for a node from its adapter slots. Multiple
   * slots enumerate each position; scalar slots contribute one descriptor.
   */
  private buildPlan(node: N): ChildPlan<N>[] {
    return this.planSlots(this.adapter.slotsOf(node));
  }

  private planSlots(
    slots: ReadonlyArray<NodeSlot<N>>,
  ): ChildPlan<N>[] {
    const plan: ChildPlan<N>[] = [];
    for (const slot of slots) {
      if (!slot.multiple) {
        const only = slot.nodes[0];
        if (only !== undefined) {
          plan.push({
            slot: slot.key,
            multiple: false,
            index: -1,
            resolve: () => ({ node: only, index: -1 }),
          });
        }
        continue;
      }
      const key = slot.key;
      const nodes = slot.nodes as ReadonlyArray<N>;
      for (let index = 0; index < nodes.length; index += 1) {
        plan.push({
          slot: key,
          multiple: true,
          index,
          resolve: () => {
            const planned = nodes[index];
            return planned === undefined ? undefined : { node: planned, index };
          },
        });
      }
    }
    return plan;
  }

  private nextPlannedChild(
    frame: Frame<N>,
  ): { node: N; slot: string; multiple: boolean; index: number } | undefined {
    if (frame.plan === (undefined as unknown)) {
      frame.plan = this.buildPlan(frame.node);
    }
    while (frame.cursor < frame.plan.length) {
      const item = frame.plan[frame.cursor];
      frame.cursor += 1;
      const resolved = item.resolve();
      if (resolved !== undefined) {
        return {
          node: resolved.node,
          slot: item.slot,
          multiple: item.multiple,
          index: resolved.index,
        };
      }
    }
    return undefined;
  }

  private buildPath(frames: ReadonlyArray<Frame<N>>): VisitPathEntry<N>[] {
    return frames.map((frame) => ({
      node: frame.node,
      kind: frame.kind,
      slot: frame.slotKey,
      index: frame.index,
    }));
  }

  private invokeEnter(
    frame: Frame<N>,
    frames: Frame<N>[],
    visitor: Visitor<N>,
    transforming: boolean,
  ): {
    pending?: PendingAction<N>;
    skip: boolean;
    stop: boolean;
  } {
    let pending: PendingAction<N> | undefined;
    let skip = false;
    let stop = false;

    const base: VisitContext<N> = {
      node: frame.node,
      kind: frame.kind,
      path: this.buildPath(frames),
      parent: frame.parent,
      slot: frame.slotKey,
      index: frame.index,
      skipChildren() {
        skip = true;
      },
      stop() {
        stop = true;
      },
    };

    let context: VisitContext<N> | TransformContext<N> = base;
    if (transforming) {
      const setPending = (action: PendingAction<N>): void => {
        if (pending !== undefined) {
          throw new Error(
            'Only one structural action (delete/replace/insert) may be issued per node visit.',
          );
        }
        pending = action;
      };
      context = {
        ...base,
        delete: () => setPending({ kind: 'delete' }),
        replace: (...nodes: N[]) => setPending({ kind: 'replace', nodes }),
        insertBefore: (...nodes: N[]) =>
          setPending({ kind: 'insert', position: 'before', nodes }),
        insertAfter: (...nodes: N[]) =>
          setPending({ kind: 'insert', position: 'after', nodes }),
      } satisfies TransformContext<N>;
    }

    const returned = visitor.enter?.(context as never) as
      | EnterResult
      | undefined;
    const decision = normalizeResult(returned);
    if (decision === SKIP) {
      skip = true;
    }
    if (decision === STOP) {
      stop = true;
    }
    return { pending, skip, stop };
  }

  private callLeave(
    frame: Frame<N>,
    frames: Frame<N>[],
    visitor: Visitor<N>,
  ): void {
    visitor.leave?.({
      node: frame.node,
      kind: frame.kind,
      path: this.buildPath(frames),
      parent: frame.parent,
      slot: frame.slotKey,
      index: frame.index,
      skipChildren() {},
      stop() {},
    });
  }

  private settleMutation(
    frame: Frame<N>,
    frames: Frame<N>[],
    roots: N[],
    rootIndex: number,
    pending: PendingAction<N>,
  ): SettleResult | undefined {
    if (frame.parent === undefined) {
      return this.settleRoot(frame, roots, rootIndex, pending);
    }

    const parentFrame = frames[frames.length - 2] as Frame<N>;
    const targetSlot = this.findMutableSlot(parentFrame, frame.slotKey);
    const location: NodeLocation<N> = {
      parent: frame.parent,
      slot: frame.slotKey,
      index: frame.index,
    };
    const currentIndex = this.indexOfLive(parentFrame, frame, targetSlot);

    if (pending.kind === 'delete') {
      this.adapter.applyAction(frame.node, location, { type: 'delete' });
      // The next sibling now occupies the same index.
      this.replanFrom(parentFrame, frame.slotKey!, currentIndex);
      return { removeFrame: true };
    }

    if (pending.kind === 'replace') {
      const count = pending.nodes.length;
      this.adapter.applyAction(frame.node, location, {
        type: 'replace',
        nodes: pending.nodes,
      });
      // Resume at the first replacement; the current frame is discarded.
      this.replanFrom(parentFrame, frame.slotKey!, currentIndex);
      for (let i = count - 1; i >= 0; i--) {
        frames.push(
          this.createFrame(
            pending.nodes[i] as N,
            frame.parent,
            frame.slotKey,
            currentIndex + i,
          ),
        );
      }
      return { removeFrame: true };
    }

    // insert siblings
    const count = pending.nodes.length;
    this.adapter.applyAction(frame.node, location, {
      type: 'insert',
      position: pending.position,
      nodes: pending.nodes,
    });
    const firstInsertedIndex =
      pending.position === 'before' ? currentIndex : currentIndex + 1;
    // After insertBefore the current node shifts to currentIndex+count; after
    // insertAfter it stays at currentIndex. In both cases the parent resumes
    // just AFTER the current node's new position because the parked current
    // frame (before) or the active current frame (after) handles itself and
    // the inserted frames are parked above it.
    const resumeAfterCurrent =
      pending.position === 'before'
        ? currentIndex + count + 1
        : currentIndex + count + 1;
    this.replanFrom(parentFrame, frame.slotKey!, resumeAfterCurrent);
    if (pending.position === 'before') {
      // Lift the current (already-entered) frame out temporarily. Stack layout
      // from top after the splice:
      //   [inserted_n ... inserted_1][current][parent...]
      // so inserted frames drain first and the current frame then resumes its
      // own subtree exactly once.
      frames.pop();
      const inserted: Frame<N>[] = [];
      for (let i = 0; i < count; i++) {
        inserted.push(
          this.createFrame(
            pending.nodes[i] as N,
            frame.parent,
            frame.slotKey,
            firstInsertedIndex + i,
          ),
        );
      }
      // Push current first, then inserted in reverse so inserted[0] is on top.
      frames.push(frame, ...[...inserted].reverse());
    } else {
      for (let i = count - 1; i >= 0; i--) {
        frames.push(
          this.createFrame(
            pending.nodes[i] as N,
            frame.parent,
            frame.slotKey,
            firstInsertedIndex + i,
          ),
        );
      }
    }
    return undefined;
  }

  /**
   * Find the current index of a child frame inside its parent's live slot by
   * object identity.
   */
  private indexOfLive(
    parentFrame: Frame<N>,
    childFrame: Frame<N>,
    slot: NodeSlot<N>,
  ): number {
    void parentFrame;
    const found = (slot.nodes as N[]).indexOf(childFrame.node);
    return found < 0 ? Math.max(childFrame.index, 0) : found;
  }

  private findMutableSlot(
    parentFrame: Frame<N>,
    slotKey: string | undefined,
  ): NodeSlot<N> {
    const slot = this.adapter
      .slotsOf(parentFrame.node)
      .find((candidate) => candidate.key === slotKey);
    if (!slot || !slot.multiple || !slot.mutable) {
      throw new TransformNotSupportedError(
        `Slot "${slotKey ?? ''}" does not support sibling edits.`,
      );
    }
    return slot;
  }

  /**
   * Replace a parent frame's child plan from `slot` starting at `startIndex`,
   * preserving already-visited positions in earlier slots.
   */
  private replanFrom(
    parentFrame: Frame<N>,
    slotKey: string,
    startIndex: number,
  ): void {
    const fresh = this.planSlots(
      this.adapter.slotsOf(parentFrame.node),
    );
    // Keep descriptors for earlier slots verbatim; rebuild the mutated slot
    // and any later slots from fresh state.
    const kept: ChildPlan<N>[] = [];
    let started = false;
    for (const descriptor of fresh) {
      if (!started && descriptor.slot !== slotKey) {
        kept.push(descriptor);
        continue;
      }
      if (descriptor.slot === slotKey && descriptor.index < startIndex) {
        kept.push(descriptor);
        continue;
      }
      started = true;
      kept.push(descriptor);
    }
    parentFrame.plan = kept;
    // cursor points one past the kept prefix.
    parentFrame.cursor = kept.findIndex(
      (descriptor) =>
        descriptor.slot === slotKey && descriptor.index >= startIndex,
    );
    if (parentFrame.cursor < 0) {
      parentFrame.cursor = kept.length;
    }
  }

  private settleRoot(
    frame: Frame<N>,
    roots: N[],
    rootIndex: number,
    pending: PendingAction<N>,
  ): SettleResult {
    if (pending.kind === 'insert') {
      throw new TransformNotSupportedError(
        'Cannot insert siblings of the traversal root.',
        frame.kind,
      );
    }
    const location: NodeLocation<N> = {
      parent: undefined,
      slot: undefined,
      index: -1,
    };
    this.adapter.applyAction(
      frame.node,
      location,
      pending.kind === 'delete'
        ? { type: 'delete' }
        : { type: 'replace', nodes: pending.nodes },
    );
    if (pending.kind === 'delete') {
      roots.splice(rootIndex, 1);
      return { deleteRoot: true };
    }
    roots.splice(rootIndex, 1, ...pending.nodes);
    return { replaceRoots: true };
  }
}
