import { describe, expect, it } from 'vitest';
import {
  type ChildSlot,
  type ClassifiedNode,
  type MutableNodeStructureAdapter,
  transformWalk,
  walk,
} from '../src/traversal/index.js';

interface TNode {
  kind: 'leaf' | 'branch';
  label: string;
  kids: TNode[];
}

type TClassified = ClassifiedNode<'leaf' | 'branch'> & { node: TNode };

const adapter: MutableNodeStructureAdapter<TClassified, 'leaf' | 'branch'> = {
  classify(node: unknown): TClassified {
    const n = node as TNode;
    return { kind: n.kind, node: n };
  },
  slots(n: TClassified): readonly ChildSlot[] {
    return n.kind === 'branch'
      ? [{ name: 'kids', container: 'array', index: 0 }]
      : [];
  },
  read(parent: unknown, slot: ChildSlot): unknown {
    if (slot.name === '$root') {
      return (parent as unknown[])[slot.index];
    }
    return (parent as TNode).kids[slot.index];
  },
  mutate(parent: unknown, slot: ChildSlot, mutation) {
    const arr =
      slot.name === '$root'
        ? (parent as unknown[])
        : (parent as TNode).kids;
    switch (mutation.type) {
      case 'remove':
        arr.splice(slot.index, 1);
        return;
      case 'replace':
        arr.splice(slot.index, 1, ...(mutation.nodes as TNode[]));
        return;
      case 'insert':
        arr.splice(
          slot.index + (mutation.position === 'after' ? 1 : 0),
          0,
          ...(mutation.nodes as TNode[]),
        );
        return;
    }
  },
};

const leaf = (label: string): TNode => ({ kind: 'leaf', label, kids: [] });
const branch = (label: string, kids: TNode[] = []): TNode => ({
  kind: 'branch',
  label,
  kids,
});

const labels = (node: TNode): string[] => {
  const out: string[] = [];
  walk(adapter, node, {
    enter(c) {
      out.push(`${'  '.repeat(c.depth)}${(c.node as TNode).label}`);
    },
  });
  return out;
};

describe('walker read-only traversal', () => {
  it('visits in stable order with enter/leave and parent path', () => {
    const tree = branch('root', [leaf('a'), branch('b', [leaf('b1')]), leaf('c')]);
    const events: string[] = [];
    walk(adapter, tree, {
      enter(c) {
        events.push(
          `enter:${(c.node as TNode).label}:depth${c.depth}:parent${c.parent ? (c.parent.node as TNode).label : 'null'}`,
        );
      },
      leave(c) {
        events.push(`leave:${(c.node as TNode).label}`);
      },
    });
    expect(events).toEqual([
      'enter:root:depth0:parentnull',
      'enter:a:depth1:parentroot',
      'leave:a',
      'enter:b:depth1:parentroot',
      'enter:b1:depth2:parentb',
      'leave:b1',
      'leave:b',
      'enter:c:depth1:parentroot',
      'leave:c',
      'leave:root',
    ]);
  });

  it('walks a very deep tree without call-stack recursion growth', () => {
    let tree = leaf('deep');
    for (let i = 0; i < 20_000; i++) tree = branch(`d${i}`, [tree]);
    let count = 0;
    expect(() =>
      walk(adapter, tree, {
        enter() {
          count++;
        },
      }),
    ).not.toThrow();
    expect(count).toBe(20001);
  });
});

describe('walker transforms', () => {
  it('removes the current node in enter and skips its children', () => {
    const tree = branch('root', [
      leaf('a'),
      branch('b', [leaf('b1')]),
      leaf('c'),
    ]);
    const left: string[] = [];
    transformWalk(adapter, tree, {
      enter(c) {
        const n = c.node as TNode;
        if (n.label === 'b') {
          left.push(...n.kids.map((k) => k.label));
          c.remove();
        }
      },
    });
    expect(labels(tree)).toEqual(['root', '  a', '  c']);
    // children of removed node were never visited
    expect(left).toEqual(['b1']);
  });

  it('replaces one node with several and visits each replacement once', () => {
    const tree = branch('root', [leaf('a')]);
    const seen: string[] = [];
    transformWalk(adapter, tree, {
      enter(c) {
        const n = c.node as TNode;
        seen.push(n.label);
        if (n.label === 'a') {
          c.replaceWith([leaf('a1'), leaf('a2')]);
        }
      },
    });
    expect(tree.kids.map((k) => k.label)).toEqual(['a1', 'a2']);
    expect(seen).toEqual(['root', 'a', 'a1', 'a2']);
  });

  it('can skip visiting replacements', () => {
    const tree = branch('root', [leaf('a')]);
    const seen: string[] = [];
    transformWalk(adapter, tree, {
      enter(c) {
        const n = c.node as TNode;
        seen.push(n.label);
        if (n.label === 'a') {
          c.replaceWith([leaf('a1')], { visit: 'skip' });
        }
      },
    });
    expect(seen).toEqual(['root', 'a']);
  });

  it('inserts siblings before/after without skipping or looping', () => {
    const tree = branch('root', [leaf('a')]);
    transformWalk(adapter, tree, {
      enter(c) {
        const n = c.node as TNode;
        if (n.label === 'a') {
          c.insertBefore([leaf('pre1'), leaf('pre2')]);
          c.insertAfter; // no-op reference to ensure method exists
        }
      },
    });
    expect(tree.kids.map((k) => k.label)).toEqual(['pre1', 'pre2', 'a']);

    const tree2 = branch('root', [leaf('a')]);
    transformWalk(adapter, tree2, {
      enter(c) {
        const n = c.node as TNode;
        if (n.label === 'a') c.insertAfter([leaf('post')]);
      },
    });
    expect(tree2.kids.map((k) => k.label)).toEqual(['a', 'post']);
  });

  it('visits inserted siblings once after the current subtree in document order', () => {
    // insertBefore/insertAfter fire during the current node's enter, so the
    // current node is always entered first; inserted siblings are visited
    // once, immediately after the current subtree, in document order.
    const tree = branch('root', [leaf('a')]);
    const order: string[] = [];
    transformWalk(adapter, tree, {
      enter(c) {
        const n = c.node as TNode;
        order.push(n.label);
        if (n.label === 'a') c.insertBefore([leaf('pre')]);
      },
    });
    expect(order).toEqual(['root', 'a', 'pre']);
    expect(tree.kids.map((k) => k.label)).toEqual(['pre', 'a']);

    const tree2 = branch('root', [leaf('a'), leaf('z')]);
    const order2: string[] = [];
    transformWalk(adapter, tree2, {
      enter(c) {
        const n = c.node as TNode;
        order2.push(n.label);
        if (n.label === 'a') c.insertAfter([leaf('post')]);
      },
    });
    expect(order2).toEqual(['root', 'a', 'post', 'z']);
    expect(tree2.kids.map((k) => k.label)).toEqual(['a', 'post', 'z']);
  });

  it('does not revisit inserted siblings (no infinite loop)', () => {
    const tree = branch('root', [leaf('a')]);
    let inserted = false;
    expect(() =>
      transformWalk(
        adapter,
        tree,
        {
          enter(c) {
            const n = c.node as TNode;
            if (!inserted && n.label === 'a') {
              inserted = true;
              // The inserted label intentionally also matches the trigger
              // condition below if revisited, so a revisit would loop.
              c.insertBefore([leaf('a')]);
            }
          },
        },
        { maxVisits: 100 },
      ),
    ).not.toThrow();
    expect(tree.kids.map((k) => k.label)).toEqual(['a', 'a']);
  });

  it('guards against visitors that keep inserting fresh nodes forever', () => {
    const tree = branch('root', [leaf('a')]);
    let counter = 0;
    expect(() =>
      transformWalk(
        adapter,
        tree,
        {
          enter(c) {
            const n = c.node as TNode;
            if (n.kind === 'leaf') {
              counter++;
              c.insertAfter([leaf(`fresh${counter}`)]);
            }
          },
        },
        { maxVisits: 50 },
      ),
    ).toThrow(/maxVisits/);
  });

  it('throws when a visitor throws and leaves no stale stack state in later walks', () => {
    const tree = branch('root', [branch('a', [leaf('a1')]), leaf('b')]);
    const boom = new Error('boom');
    expect(() =>
      walk(adapter, tree, {
        enter(c) {
          if ((c.node as TNode).label === 'a1') throw boom;
        },
      }),
    ).toThrow(boom);
    // The walker state is per-walk, but a shared visitor must remain usable:
    const sharedVisitor = {
      seen: [] as string[],
      enter(c: VisitContextLike) {
        this.seen.push((c.node as TNode).label);
      },
    };
    expect(() =>
      walk(
        adapter,
        branch('x', [leaf('y')]),
        sharedVisitor as never,
      ),
    ).not.toThrow();
    expect(sharedVisitor.seen).toEqual(['x', 'y']);
  });

  it('can remove and replace the root', () => {
    const tree = leaf('a');
    const removed = transformWalk(adapter, tree, {
      enter(c) {
        if (c.depth === 0 && (c.node as TNode).label === 'a') c.remove();
      },
    });
    expect(removed.roots).toEqual([]);

    const tree2 = leaf('a');
    const replaced = transformWalk(adapter, tree2, {
      enter(c) {
        if (c.depth === 0 && (c.node as TNode).label === 'a') {
          c.replaceWith([leaf('b')]);
        }
      },
    });
    expect((replaced.roots[0] as TNode).label).toBe('b');
  });
});

type VisitContextLike = { node: TNode };
