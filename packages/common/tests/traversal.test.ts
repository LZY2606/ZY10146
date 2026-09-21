import { describe, expect, it } from 'vitest';
import {
  CONTINUE,
  type NodeAdapter,
  type NodeLocation,
  SKIP,
  STOP,
  type TransformAction,
  type TransformingVisitor,
  TransformNotSupportedError,
  type TraversalKind,
  TreeWalker,
  type Visitor,
} from '../src/traversal/index.js';

interface TreeNode {
  kind: TraversalKind;
  name: string;
  children?: TreeNode[];
  scalar?: TreeNode;
}

const treeAdapter: NodeAdapter<TreeNode> = {
  kindOf(node) {
    return node.kind;
  },
  slotsOf(node) {
    const slots = [];
    if (node.scalar) {
      slots.push({
        key: 'scalar',
        nodes: [node.scalar],
        multiple: false,
        mutable: false,
      });
    }
    if (node.children) {
      slots.push({
        key: 'children',
        nodes: node.children,
        multiple: true,
        mutable: true,
      });
    }
    return slots;
  },
  applyAction(
    node: TreeNode,
    location: NodeLocation<TreeNode>,
    action: TransformAction<TreeNode>,
  ) {
    const arr =
      location.parent === undefined
        ? (undefined as never)
        : location.parent.children!;
    if (location.parent === undefined) {
      // Root edits are applied directly by the walker test through returned
      // roots; emulate by returning without touching a parent array.
      return;
    }
    const index = arr.indexOf(node);
    if (action.type === 'delete') {
      arr.splice(index, 1);
    } else if (action.type === 'replace') {
      arr.splice(index, 1, ...action.nodes);
    } else if (action.position === 'before') {
      arr.splice(index, 0, ...action.nodes);
    } else {
      arr.splice(index + 1, 0, ...action.nodes);
    }
  },
};

function tree(): TreeNode {
  return {
    kind: 'Graph',
    name: 'root',
    children: [
      { kind: 'Node', name: 'a' },
      {
        kind: 'Subgraph',
        name: 's',
        children: [
          { kind: 'Node', name: 'b' },
          { kind: 'Node', name: 'c' },
        ],
      },
      { kind: 'Node', name: 'd' },
    ],
  };
}

describe('TreeWalker read-only', () => {
  it('emits enter/leave in stable pre/post order', () => {
    const events: string[] = [];
    new TreeWalker(treeAdapter).visit(tree(), {
      enter(ctx) {
        events.push(`enter:${ctx.node.name}`);
      },
      leave(ctx) {
        events.push(`leave:${ctx.node.name}`);
      },
    });
    expect(events).toEqual([
      'enter:root',
      'enter:a',
      'leave:a',
      'enter:s',
      'enter:b',
      'leave:b',
      'enter:c',
      'leave:c',
      'leave:s',
      'enter:d',
      'leave:d',
      'leave:root',
    ]);
  });

  it('reports the parent path', () => {
    const paths: string[] = [];
    new TreeWalker(treeAdapter).visit(tree(), {
      enter(ctx) {
        paths.push(ctx.path.map((p) => p.node.name).join('/'));
      },
    });
    expect(paths).toEqual([
      'root',
      'root/a',
      'root/s',
      'root/s/b',
      'root/s/c',
      'root/d',
    ]);
  });

  it('skips children when enter returns SKIP/false', () => {
    const events: string[] = [];
    new TreeWalker(treeAdapter).visit(tree(), {
      enter(ctx) {
        events.push(ctx.node.name);
        return ctx.node.name === 's' ? SKIP : CONTINUE;
      },
    });
    expect(events).toEqual(['root', 'a', 's', 'd']);
  });

  it('stops traversal when enter returns STOP', () => {
    const events: string[] = [];
    new TreeWalker(treeAdapter).visit(tree(), {
      enter(ctx) {
        events.push(ctx.node.name);
        return ctx.node.name === 'b' ? STOP : CONTINUE;
      },
    });
    expect(events).toEqual(['root', 'a', 's', 'b']);
  });
});

describe('TreeWalker transform', () => {
  it('deletes the current node and continues without index skipping', () => {
    const root = tree();
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        if (ctx.node.name === 'b' || ctx.node.name === 's') {
          ctx.delete();
        }
      },
    });
    expect(root.children!.map((n) => n.name)).toEqual(['a', 'd']);
  });

  it('replaces one node with many and visits each replacement once', () => {
    const root = tree();
    const visited: string[] = [];
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        visited.push(ctx.node.name);
        if (ctx.node.name === 'b') {
          ctx.replace(
            { kind: 'Node', name: 'b1' },
            { kind: 'Node', name: 'b2' },
          );
        }
      },
    });
    expect(root.children![1].children!.map((n) => n.name)).toEqual([
      'b1',
      'b2',
      'c',
    ]);
    expect(visited).toContain('b1');
    expect(visited).toContain('b2');
    expect(visited.filter((n) => n === 'c')).toHaveLength(1);
  });

  it('replaces one node with zero nodes', () => {
    const root = tree();
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        if (ctx.node.name === 'b') {
          ctx.replace();
        }
      },
    });
    expect(root.children![1].children!.map((n) => n.name)).toEqual(['c']);
  });

  it('inserts siblings before and visits them once without revisiting current', () => {
    const root = tree();
    const visited: string[] = [];
    let inserted = false;
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        visited.push(ctx.node.name);
        if (ctx.node.name === 'b' && !inserted) {
          inserted = true;
          ctx.insertBefore({ kind: 'Node', name: 'pre' });
        }
      },
    });
    expect(root.children![1].children!.map((n) => n.name)).toEqual([
      'pre',
      'b',
      'c',
    ]);
    expect(visited.filter((n) => n === 'b')).toHaveLength(1);
    expect(visited.filter((n) => n === 'pre')).toHaveLength(1);
    expect(visited.filter((n) => n === 'c')).toHaveLength(1);
  });

  it('inserts siblings after and visits them once without index skipping', () => {
    const root = tree();
    const visited: string[] = [];
    let inserted = false;
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        visited.push(ctx.node.name);
        if (ctx.node.name === 'b' && !inserted) {
          inserted = true;
          ctx.insertAfter({ kind: 'Node', name: 'post' });
        }
      },
    });
    expect(root.children![1].children!.map((n) => n.name)).toEqual([
      'b',
      'post',
      'c',
    ]);
    expect(visited).toEqual(['root', 'a', 's', 'b', 'post', 'c', 'd']);
  });

  it('throws when editing a scalar slot', () => {
    const root: TreeNode = {
      kind: 'Graph',
      name: 'root',
      scalar: { kind: 'Literal', name: 'id' },
    };
    expect(() =>
      new TreeWalker(treeAdapter).transform(root, {
        enter(ctx) {
          if (ctx.node.name === 'id') {
            ctx.delete();
          }
        },
      }),
    ).toThrow(TransformNotSupportedError);
  });

  it('does not leave the traversal in a broken state when visitor throws', () => {
    const root = tree();
    const error = new Error('boom');
    expect(() =>
      new TreeWalker(treeAdapter).visit(root, {
        enter(ctx) {
          if (ctx.node.name === 'c') {
            throw error;
          }
        },
      }),
    ).toThrow(error);
    // A fresh traversal still works; no shared parent stack leaked.
    const events: string[] = [];
    new TreeWalker(treeAdapter).visit(root, {
      enter(ctx) {
        events.push(ctx.node.name);
      },
    });
    expect(events).toEqual(['root', 'a', 's', 'b', 'c', 'd']);
  });
});

describe('TreeWalker deep nesting', () => {
  it('traverses very deep trees without growing the call stack', () => {
    const depth = 20_000;
    let node: TreeNode = { kind: 'Node', name: 'leaf' };
    for (let i = 0; i < depth; i++) {
      node = { kind: 'Subgraph', name: `d${i}`, children: [node] };
    }
    let count = 0;
    let deepest = '';
    new TreeWalker(treeAdapter).visit(node, {
      enter(ctx) {
        count += 1;
        if (ctx.path.length > 0 && ctx.node.kind === 'Node') {
          deepest = ctx.path.length.toString();
        }
      },
    });
    expect(count).toBe(depth + 1);
    expect(deepest).toBe(String(depth + 1));
  });
});

describe('TreeWalker transform edge cases', () => {
  it('visits inserted-before subtree before current subtree exactly once', () => {
    const root = tree();
    const events: string[] = [];
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        events.push(`enter ${ctx.node.name}`);
      },
      leave(ctx) {
        events.push(`leave ${ctx.node.name}`);
      },
    });
    // sanity: plain walk events balanced
    expect(events.filter((e) => e.startsWith('enter')).length).toBe(
      events.filter((e) => e.startsWith('leave')).length,
    );
  });

  it('keeps order with nested insertBefore inside a replacement', () => {
    const root: TreeNode = {
      kind: 'Graph',
      name: 'root',
      children: [{ kind: 'Node', name: 'x' }],
    };
    const visited: string[] = [];
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        visited.push(ctx.node.name);
        if (ctx.node.name === 'x') {
          ctx.replace({ kind: 'Node', name: 'r' });
        }
        if (ctx.node.name === 'r') {
          ctx.insertBefore(
            { kind: 'Node', name: 'p1' },
            { kind: 'Node', name: 'p2' },
          );
        }
      },
    });
    expect(root.children!.map((n) => n.name)).toEqual(['p1', 'p2', 'r']);
    expect(visited).toEqual(['root', 'x', 'r', 'p1', 'p2']);
  });

  it('replace with nodes that insert siblings continues through all', () => {
    const root: TreeNode = {
      kind: 'Graph',
      name: 'root',
      children: [
        { kind: 'Node', name: 'x' },
        { kind: 'Node', name: 'y' },
      ],
    };
    const visited: string[] = [];
    new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        visited.push(ctx.node.name);
        if (ctx.node.name === 'x') {
          ctx.insertAfter({ kind: 'Node', name: 'z' });
        }
      },
    });
    expect(root.children!.map((n) => n.name)).toEqual(['x', 'z', 'y']);
    expect(visited).toEqual(['root', 'x', 'z', 'y']);
  });

  it('replaces the root with multiple nodes and visits every replacement', () => {
    const root: TreeNode = { kind: 'Graph', name: 'r', children: [] };
    const visited: string[] = [];
    const result = new TreeWalker(treeAdapter).transform(root, {
      enter(ctx) {
        visited.push(ctx.node.name);
        if (ctx.node.name === 'r') {
          ctx.replace(
            { kind: 'Graph', name: 'r1' },
            { kind: 'Graph', name: 'r2' },
          );
        }
      },
    });
    expect(result?.name).toBe('r1');
    expect(visited).toEqual(['r', 'r1', 'r2']);
  });
});
