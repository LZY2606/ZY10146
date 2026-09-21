import type {
  ChildSlot,
  ClassifiedNode,
  MutableNodeStructureAdapter,
  SlotMutation,
  TransformVisitContext,
  VisitContext,
  VisitInsertOptions,
  VisitPathEntry,
  Visitor,
} from './protocol-types.js';

export type {
  ChildSlot,
  ClassifiedNode,
  VisitContext,
  TransformVisitContext,
  VisitInsertOptions,
  VisitPathEntry,
  Visitor,
  NodeStructureAdapter,
  MutableNodeStructureAdapter,
  SlotMutation,
  SlotContainerKind,
} from './protocol-types.js';

/**
 * Mapped record that forces one entry per node kind.
 *
 * A `satisfies NodeKindRecord<Kind, Value>` declaration fails to compile when
 * a new kind is added to the union but not handled.
 */
export type NodeKindRecord<Kind extends PropertyKey, Value> = {
  [K in Kind]: Value;
};

/**
 * Compile-time exhaustiveness check. Place in the final fallback of a kind
 * `switch`; if `value` is not `never`, a kind was missed.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled node kind: ${JSON.stringify(value as unknown)}`);
}

export interface WalkResult {
  /**
   * Root nodes after the walk (one element for read-only walks; only
   * transforms can remove or multiply the root).
   */
  readonly roots: readonly unknown[];
}

export interface WalkOptions {
  /**
   * Safety cap on total `enter` calls. The walker visits every concrete node
   * at most once, so this only guards against visitors that keep inserting
   * fresh nodes forever. Defaults to no cap.
   */
  maxVisits?: number;
}

type EnterEdit =
  | { type: 'none' }
  | { type: 'removed' }
  | { type: 'replaced'; count: number; visit: boolean }
  | { type: 'insertedBefore'; count: number; visit: boolean }
  | { type: 'insertedAfter'; count: number; visit: boolean };

type Work<Kind extends PropertyKey> =
  | {
      kind: 'visit';
      raw: unknown;
      parentRaw: unknown;
      slot: ChildSlot;
      visibleSlot: ChildSlot | null;
      /**
       * Scan that produced (or is logically responsible for) this visit.
       * Only defined for visits scheduled by an array/property scan; enter
       * edits adjust this scan's cursor.
       */
      scan: ScanWork<Kind> | null;
    }
  | { kind: 'scan'; ref: ScanWork<Kind> }
  | {
      kind: 'leave';
      parentRaw: unknown;
      slot: ChildSlot;
      visibleSlot: ChildSlot | null;
      classified: ClassifiedNode<Kind>;
      scan: ScanWork<Kind> | null;
    };

interface ScanWork<Kind extends PropertyKey> {
  parentRaw: unknown;
  slots: readonly ChildSlot[];
  sp: number;
  i: number;
  /** Set when the next sibling must be skipped (used by leave edits). */
  skip: number;
  // phantom type carrier
  __kind?: Kind;
}

/**
 * Iterative depth-first traversal with enter/leave semantics.
 *
 * Fully iterative: nesting depth is carried by heap work items, not by the
 * call stack, so deeply nested trees cannot grow the call stack inside the
 * traversal skeleton.
 */
export function walk<
  Nodes extends ClassifiedNode<Kind>,
  Kind extends PropertyKey,
>(
  adapter: MutableNodeStructureAdapter<Nodes, Kind>,
  root: unknown,
  visitor: Visitor<Kind, VisitContext<Kind>>,
  options?: WalkOptions,
): WalkResult {
  return runWalk(adapter, root, visitor, false, options);
}

/**
 * Iterative depth-first traversal allowing structural edits.
 * See {@link TransformVisitContext} for edit semantics.
 */
export function transformWalk<
  Nodes extends ClassifiedNode<Kind>,
  Kind extends PropertyKey,
>(
  adapter: MutableNodeStructureAdapter<Nodes, Kind>,
  root: unknown,
  visitor: Visitor<Kind, TransformVisitContext<Kind>>,
  options?: WalkOptions,
): WalkResult {
  return runWalk(adapter, root, visitor, true, options);
}

function runWalk<
  Nodes extends ClassifiedNode<Kind>,
  Kind extends PropertyKey,
>(
  adapter: MutableNodeStructureAdapter<Nodes, Kind>,
  root: unknown,
  visitor:
    | Visitor<Kind, VisitContext<Kind>>
    | Visitor<Kind, TransformVisitContext<Kind>>,
  mutable: boolean,
  options: WalkOptions | undefined,
): WalkResult {
  // The root is the sole item of a virtual array slot so the same edit
  // machinery applies to it (including root remove/replace).
  const virtualRoot: unknown[] = [root];
  const rootArraySlot: ChildSlot = {
    name: '$root',
    container: 'array',
    index: 0,
  };
  const rootScan: ScanWork<Kind> = {
    parentRaw: virtualRoot,
    slots: [rootArraySlot],
    sp: 0,
    i: 0,
    skip: 0,
  };

  // Stack of pending work (LIFO).
  const stack: Work<Kind>[] = [
    { kind: 'scan', ref: rootScan },
  ];
  // Shared, in-place parent path. Cleared on exceptional exit so a reused
  // visitor never observes a stale stack.
  const path: VisitPathEntry<Kind>[] = [];
  // Identity de-duplication: every concrete node is entered at most once.
  const visited = new WeakSet<object>();
  let visits = 0;
  const maxVisits = options?.maxVisits ?? Number.POSITIVE_INFINITY;

  const fail = (error: unknown): never => {
    stack.length = 0;
    path.length = 0;
    throw error;
  };

  const buildContext = (
    classified: ClassifiedNode<Kind>,
    slot: ChildSlot | null,
  ): VisitContext<Kind> => {
    const current: VisitPathEntry<Kind> = { ...classified, slot };
    return {
      kind: classified.kind,
      node: classified.node,
      slot,
      root: rootClassified,
      path,
      current,
      parent: path.length > 0 ? (path[path.length - 1] ?? null) : null,
      depth: path.length,
    };
  };
  const rootClassified: ClassifiedNode<Kind> = adapter.classify(root);

  type VisitWork = Extract<Work<Kind>, { kind: 'visit' }>;

  const makeTransform = (
    classified: ClassifiedNode<Kind>,
    parentRaw: unknown,
    liveSlot: ChildSlot,
    visibleSlot: ChildSlot | null,
    getEdit: () => EnterEdit,
    setEdit: (edit: EnterEdit) => void,
  ): TransformVisitContext<Kind> => {
    const base = buildContext(classified, visibleSlot);
    const requireUniqueEdit = (): void => {
      if (getEdit().type !== 'none') {
        throw new Error(
          'A structural edit was already requested for this enter/leave visit.',
        );
      }
    };
    const requireArray = (): void => {
      if (liveSlot.container !== 'array') {
        throw new Error(
          'insertBefore/insertAfter are only supported inside array child slots.',
        );
      }
    };
    return {
      ...base,
      remove() {
        requireUniqueEdit();
        mutateChild(parentRaw, liveSlot, { type: 'remove' });
        setEdit({ type: 'removed' });
      },
      replaceWith(nodes: readonly unknown[], opts?: VisitInsertOptions) {
        requireUniqueEdit();
        if (nodes.length === 0) {
          throw new Error('replaceWith requires at least one node.');
        }
        if (liveSlot.container === 'property' && nodes.length !== 1) {
          throw new Error(
            'Property slots accept exactly one replacement node.',
          );
        }
        mutateChild(parentRaw, liveSlot, { type: 'replace', nodes });
        setEdit({
          type: 'replaced',
          count: nodes.length,
          visit: opts?.visit !== 'skip',
        });
      },
      insertBefore(nodes: readonly unknown[], opts?: VisitInsertOptions) {
        requireUniqueEdit();
        requireArray();
        if (nodes.length === 0) {
          throw new Error('insertBefore requires at least one node.');
        }
        mutateChild(parentRaw, liveSlot, {
          type: 'insert',
          position: 'before',
          nodes,
        });
        setEdit({
          type: 'insertedBefore',
          count: nodes.length,
          visit: opts?.visit !== 'skip',
        });
      },
      insertAfter(nodes: readonly unknown[], opts?: VisitInsertOptions) {
        requireUniqueEdit();
        requireArray();
        if (nodes.length === 0) {
          throw new Error('insertAfter requires at least one node.');
        }
        mutateChild(parentRaw, liveSlot, {
          type: 'insert',
          position: 'after',
          nodes,
        });
        setEdit({
          type: 'insertedAfter',
          count: nodes.length,
          visit: opts?.visit !== 'skip',
        });
      },
    };
  };

  const readAt = (parentRaw: unknown, slot: ChildSlot, index: number): unknown =>
    slot.container === 'property'
      ? adapter.read(parentRaw, slot)
      : adapter.read(parentRaw, { ...slot, container: 'array', index });

  const readChild = (parentRaw: unknown, slot: ChildSlot, index: number): unknown => {
    if (slot.name === '$root' && parentRaw === virtualRoot) {
      return virtualRoot[index];
    }
    return readAt(parentRaw, slot, index);
  };

  const mutateChild = (
    parentRaw: unknown,
    slot: ChildSlot,
    mutation: SlotMutation,
  ): void => {
    if (slot.name === '$root' && parentRaw === virtualRoot) {
      if (mutation.type === 'remove') {
        virtualRoot.splice(slot.index, 1);
      } else if (mutation.type === 'replace') {
        virtualRoot.splice(slot.index, 1, ...(mutation.nodes as unknown[]));
      } else {
        virtualRoot.splice(
          slot.index + (mutation.position === 'after' ? 1 : 0),
          0,
          ...(mutation.nodes as unknown[]),
        );
      }
      return;
    }
    adapter.mutate(parentRaw, slot, mutation);
  };

  /**
   * Schedule one node visit plus, underneath it, the continuation scan that
   * will enumerate its following siblings once the subtree completes.
   *
   * Stack (top→bottom) after scheduling:
   *   [visit(node), scan(continuation), <older stack...>]
   */
  const schedule = (
    raw: unknown,
    parentRaw: unknown,
    slot: ChildSlot,
    visibleSlot: ChildSlot | null,
    continuation: ScanWork<Kind> | null,
  ): void => {
    if (continuation) stack.push({ kind: 'scan', ref: continuation });
    stack.push({
      kind: 'visit',
      raw,
      parentRaw,
      slot,
      visibleSlot,
      scan: continuation,
    });
  };

  const nextFromScan = (
    scan: ScanWork<Kind>,
  ): { raw: unknown; slot: ChildSlot } | null => {
    for (;;) {
      if (scan.sp >= scan.slots.length) return null;
      const descriptor = scan.slots[scan.sp];
      if (descriptor.container === 'property') {
        scan.sp++;
        scan.i = 0;
        const value = readChild(scan.parentRaw, descriptor, 0);
        if (value === undefined || value === null) continue;
        if (typeof value === 'object' && value !== null && visited.has(value)) {
          continue;
        }
        return { raw: value, slot: { ...descriptor, index: 0 } };
      }
      // Array slot.
      if (scan.skip > 0) {
        scan.i += scan.skip;
        scan.skip = 0;
      }
      const value = readChild(scan.parentRaw, descriptor, scan.i);
      if (value === undefined || value === null) {
        scan.sp++;
        scan.i = 0;
        continue;
      }
      const index = scan.i;
      scan.i++;
      if (typeof value === 'object' && value !== null && visited.has(value)) {
        continue;
      }
      return {
        raw: value,
        slot: { ...descriptor, container: 'array', index },
      };
    }
  };

  /**
   * Schedule follow-up work for an edit performed in `enter`.
   *
   * The original node is already in the visited set, so it is never entered
   * again. When `visit` is enabled, replacements/inserts are scheduled as
   * explicit visits (each such node is unvisited). When disabled they are
   * marked visited so surrounding scans skip them.
   *
   * In every case the responsible sibling scan's continuation is arranged so
   * that following siblings are visited exactly once (no index skipping, no
   * double visits).
   */
  const scheduleEnterEdit = (
    item: VisitWork,
    edit: Exclude<EnterEdit, { type: 'none' }>,
  ): void => {
    const { parentRaw, slot, visibleSlot, scan } = item;
    const isProperty = slot.container === 'property';

    const markVisited = (index: number): void => {
      const node = readAt(parentRaw, slot, index);
      if (typeof node === 'object' && node !== null) visited.add(node);
    };

    const scheduleAt = (index: number): void => {
      const rawNode = readChild(parentRaw, slot, index);
      const childSlot: ChildSlot = isProperty
        ? slot
        : { ...slot, container: 'array', index };
      const childVisible: ChildSlot | null =
        isProperty || visibleSlot === null
          ? visibleSlot
          : { ...slot, container: 'array', index };
      schedule(rawNode, parentRaw, childSlot, childVisible, null);
    };

    // Continuation for following siblings. The virtual root array contains
    // only the root, so after a root edit there is nothing to continue.
    const isVirtualRoot = slot.name === '$root';
    if (scan && !isVirtualRoot) {
      let skip = 0;
      if (isProperty) {
        // Property continuation naturally advances the slot.
        stack.push({ kind: 'scan', ref: scan });
      } else {
        // Default: the node occupied one array position. Compute how many
        // positions the continuation must jump relative to (index+1).
        if (edit.type === 'removed') {
          // Array collapsed by one; cursor must stay at the same index.
          skip = -1;
        } else if (edit.type === 'replaced') {
          skip = edit.count - 1;
        } else if (edit.type === 'insertedBefore') {
          skip = edit.count;
        } else if (edit.type === 'insertedAfter') {
          skip = edit.count;
        }
        const cont: ScanWork<Kind> = {
          parentRaw: scan.parentRaw,
          slots: scan.slots,
          sp: scan.sp,
          i: slot.index + 1 + skip,
          skip: 0,
        };
        stack.push({ kind: 'scan', ref: cont });
      }
    }

    if (isProperty) {
      if (edit.type === 'replaced' && edit.visit) scheduleAt(0);
      else if (edit.type === 'replaced') markVisited(0);
      return;
    }

    const base = slot.index;
    switch (edit.type) {
      case 'removed':
        // The next occupant shifted into base; the continuation already
        // points at base (skip=-1). Nothing extra to schedule.
        return;
      case 'replaced':
        if (edit.visit) {
          // Schedule replacements in document order: push last first.
          for (let k = edit.count - 1; k >= 0; k--) scheduleAt(base + k);
        } else {
          for (let k = 0; k < edit.count; k++) markVisited(base + k);
        }
        return;
      case 'insertedBefore':
        if (edit.visit) {
          // Inserts occupy [base, base+count-1]; original moved to
          // base+count but must not be revisited (it is in visited already
          // and currently on the call path — its subtree must still run).
          // Because the current enter already fired, we still need to run
          // the original's CHILDREN. We schedule inserts as visits, and run
          // the current node's children separately below.
          for (let k = edit.count - 1; k >= 0; k--) scheduleAt(base + k);
          scheduleCurrentChildren(item);
        } else {
          for (let k = 0; k < edit.count; k++) markVisited(base + k);
          scheduleCurrentChildren(item);
        }
        return;
      case 'insertedAfter':
        if (edit.visit) {
          // Run current children first (top), then inserts after it.
          // Stack top should be current children scan; below it inserts.
          for (let k = edit.count - 1; k >= 0; k--) scheduleAt(base + 1 + k);
          scheduleCurrentChildren(item);
        } else {
          for (let k = 1; k <= edit.count; k++) markVisited(base + k);
          scheduleCurrentChildren(item);
        }
        return;
    }
  };

  /**
   * Run the current node's children + leave even though its enter already
   * fired (used by insert edits, which keep the original node in place).
   */
  const scheduleCurrentChildren = (item: VisitWork): void => {
    // The path entry for the current node was popped; re-push a synthetic
    // leave so parent path/leave semantics stay consistent.
    const classifiedNow = adapter.classify(item.raw);
    path.push({ ...classifiedNow, slot: item.visibleSlot });
    const childSlots = adapter.slots(classifiedNow as Nodes);
    const childScan: ScanWork<Kind> = {
      parentRaw: item.raw,
      slots: childSlots,
      sp: 0,
      i: 0,
      skip: 0,
    };
    stack.push({
      kind: 'leave',
      parentRaw: item.parentRaw,
      slot: item.slot,
      visibleSlot: item.visibleSlot,
      classified: classifiedNow,
      scan: null,
    });
    stack.push({ kind: 'scan', ref: childScan });
  };

  for (;;) {
    const work = stack.pop();
    if (!work) break;

    if (work.kind === 'scan') {
      const found = nextFromScan(work.ref);
      if (!found) continue;
      const isVirtualRoot = found.slot.name === '$root';
      schedule(
        found.raw,
        work.ref.parentRaw,
        found.slot,
        isVirtualRoot ? null : found.slot,
        isVirtualRoot ? null : work.ref,
      );
      continue;
    }

    if (work.kind === 'leave') {
      const leaveHolder: { edit: EnterEdit } = { edit: { type: 'none' } };
      const leaveContext = mutable
        ? makeTransform(
            work.classified,
            work.parentRaw,
            work.slot,
            work.visibleSlot,
            () => leaveHolder.edit,
            (next) => {
              if (leaveHolder.edit.type !== 'none') {
                throw new Error(
                  'A structural edit was already requested for this leave visit.',
                );
              }
              leaveHolder.edit = next;
            },
          )
        : buildContext(work.classified, work.visibleSlot);
      try {
        visitor.leave?.(leaveContext as never);
      } catch (error) {
        fail(error);
      }
      const leaveEdit = leaveHolder.edit;
      // Leave-time edits: inserted/replaced siblings are not revisited.
      if (work.scan && work.slot.container === 'array') {
        if (leaveEdit.type === 'insertedBefore') {
          // Inserts sit before the (just-left) node; the continuation cursor
          // already moved past the node, so jump over the inserts too.
          work.scan.i += leaveEdit.count;
        } else if (leaveEdit.type === 'insertedAfter') {
          // Continuation cursor already points at the first insert; skip.
          work.scan.i += leaveEdit.count;
        } else if (leaveEdit.type === 'removed') {
          work.scan.i -= 1;
        } else if (leaveEdit.type === 'replaced') {
          work.scan.i += leaveEdit.count - 1;
        }
      } else if (
        work.scan &&
        work.slot.container === 'property' &&
        leaveEdit.type === 'replaced'
      ) {
        const replacement = readChild(work.parentRaw, work.slot, 0);
        if (typeof replacement === 'object' && replacement !== null) {
          visited.add(replacement);
        }
      }
      path.pop();
      continue;
    }

    // work.kind === 'visit'
    if (work.raw === undefined || work.raw === null) continue;
    if (typeof work.raw === 'object' && work.raw !== null) {
      if (visited.has(work.raw)) continue;
      visited.add(work.raw);
    }
    const classified = adapter.classify(work.raw);
    visits += 1;
    if (visits > maxVisits) {
      throw new Error(
        `Traversal exceeded maxVisits limit of ${maxVisits}. This usually means a transform visitor keeps inserting fresh nodes.`,
      );
    }

    const editHolder: { edit: EnterEdit } = { edit: { type: 'none' } };
    const enterContext = mutable
      ? makeTransform(
          classified,
          work.parentRaw,
          work.slot,
          work.visibleSlot,
          () => editHolder.edit,
          (next) => {
            editHolder.edit = next;
          },
        )
      : buildContext(classified, work.visibleSlot);

    path.push({ ...classified, slot: work.visibleSlot });
    try {
      visitor.enter?.(enterContext as never);
    } catch (error) {
      fail(error);
    }

    const edit = editHolder.edit;
    if (edit.type === 'none') {
      // Descend children, then leave. Stack: [continuation?, leave, scanChildren]
      const childSlots = adapter.slots(classified as Nodes);
      const childScan: ScanWork<Kind> = {
        parentRaw: work.raw,
        slots: childSlots,
        sp: 0,
        i: 0,
        skip: 0,
      };
      if (work.scan) stack.push({ kind: 'scan', ref: work.scan });
      stack.push({
        kind: 'leave',
        parentRaw: work.parentRaw,
        slot: work.slot,
        visibleSlot: work.visibleSlot,
        classified,
        scan: work.scan,
      });
      stack.push({ kind: 'scan', ref: childScan });
      continue;
    }

    // Enter-time structural edit. The tree was already mutated by the
    // transform methods; here we only schedule the follow-up traversal.
    path.pop();
    scheduleEnterEdit(work, edit);
  }


  return { roots: [...virtualRoot] };
}
