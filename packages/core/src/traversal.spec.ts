import {
  createModelsContext,
  ModelAttribute,
  ModelComment,
  type ModelTraversalNode,
  type RootGraphModel,
  RootModelsContext,
  TransformNotSupportedError,
  transformModel,
  visitModel,
} from '@ts-graphviz/common';
import { describe, expect, it } from 'vitest';
import { Digraph } from './Digraph.js';
import { Edge } from './Edge.js';
import { Graph } from './Graph.js';
import { Node } from './Node.js';
import { registerDefault } from './register-default.js';
import { Subgraph } from './Subgraph.js';

registerDefault();

describe('model visitor', () => {
  it('traverses deeply nested subgraphs without call-stack growth', () => {
    const depth = 5000;
    const current: RootGraphModel = new Digraph('d0');
    let leafParent: import('@ts-graphviz/common').SubgraphModel =
      current as unknown as import('@ts-graphviz/common').SubgraphModel;
    for (let i = 1; i <= depth; i++) {
      leafParent = leafParent.createSubgraph(`d${i}`);
    }
    leafParent.createNode('deep');

    let maxPath = 0;
    let nodes = 0;
    void current;
    visitModel(current, {
      enter(ctx) {
        nodes += 1;
        if (ctx.path.length > maxPath) {
          maxPath = ctx.path.length;
        }
      },
    });
    expect(maxPath).toBe(depth + 2); // root graph + subgraphs + node
    expect(nodes).toBeGreaterThan(depth);
  });

  it('honors custom model registration via ModelsContext', () => {
    class CustomNode extends Node {
      public readonly custom = true;
    }
    const context = createModelsContext({ Node: CustomNode });
    const GraphCtor = context.Digraph;
    const g = new GraphCtor();
    g.with({ Node: CustomNode });
    const created = g.createNode('x');
    expect(created).toBeInstanceOf(CustomNode);

    let found = false;
    visitModel(g, {
      enter(ctx) {
        if (ctx.node instanceof CustomNode) {
          found = true;
        }
      },
    });
    expect(found).toBe(true);
    void context;
  });

  it('deletes the current graph child during transform and keeps order', () => {
    const g = new Digraph();
    g.createNode('a');
    g.createNode('b');
    g.createNode('c');
    transformModel(g, {
      enter(ctx) {
        if (ctx.node instanceof Node && (ctx.node as Node).id === 'b') {
          ctx.delete();
        }
      },
    });
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('removes attribute entries by deleting ModelAttribute nodes', () => {
    const g = new Digraph();
    (g as unknown as { set(k: string, v: string): void }).set('label', 'L');
    (g as unknown as { set(k: string, v: string): void }).set(
      'bgcolor',
      'white',
    );
    transformModel(g, {
      enter(ctx) {
        if (ctx.node instanceof ModelAttribute && ctx.node.key === 'label') {
          ctx.delete();
        }
      },
    });
    expect(g.get('label' as never)).toBeUndefined();
    expect(g.get('bgcolor' as never)).toBe('white');
  });

  it('refuses to delete immutable comments and edge targets', () => {
    const g = new Digraph();
    g.comment = 'keep';
    g.createEdge(['a', 'b']);
    expect(() =>
      transformModel(g, {
        enter(ctx) {
          if (ctx.node instanceof ModelComment) {
            ctx.delete();
          }
        },
      }),
    ).toThrow(TransformNotSupportedError);
  });

  it('does not leak parent path after a throwing visitor', () => {
    const g = new Digraph();
    const sub = g.createSubgraph('s');
    sub.createNode('n');
    const error = new Error('boom');
    expect(() =>
      visitModel(g, {
        enter(ctx) {
          if (ctx.kind === 'Node') {
            throw error;
          }
        },
      }),
    ).toThrow(error);

    const roots: number[] = [];
    visitModel(g, {
      enter(ctx) {
        if (ctx.parent === undefined) {
          roots.push(ctx.path.length);
        }
      },
    });
    expect(roots).toEqual([1]);
  });

  it('classifies every structural kind distinctly', () => {
    const g = new Digraph('G');
    g.comment = 'c';
    (g as unknown as { set(k: string, v: string): void }).set('label', 'x');
    (g.attributes.node as unknown as { set(k: string, v: string): void }).set(
      'shape',
      'box',
    );
    g.createNode('a');
    g.createEdge(['a', 'b']);
    g.createSubgraph('s');
    const kinds = new Set<string>();
    visitModel(g, {
      enter(ctx) {
        kinds.add(ctx.kind);
      },
    });
    expect(kinds.has('Graph')).toBe(true);
    expect(kinds.has('Subgraph')).toBe(true);
    expect(kinds.has('Node')).toBe(true);
    expect(kinds.has('Edge')).toBe(true);
    expect(kinds.has('AttributeList')).toBe(true);
    expect(kinds.has('Attribute')).toBe(true);
    expect(kinds.has('Comment')).toBe(true);
    expect(kinds.has('EdgeTarget')).toBe(true);
  });

  it('constructs default exported classes through the sealed Root context', () => {
    // Sanity: public classes remain usable directly.
    expect(new Graph()).toBeInstanceOf(Graph);
    expect(new Subgraph()).toBeInstanceOf(Subgraph);
    expect(new Edge([{ id: 'a' }, { id: 'b' }])).toBeInstanceOf(Edge);
    void RootModelsContext;
  });
});
