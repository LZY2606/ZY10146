import { registerDefault } from '@ts-graphviz/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { fromDot, toDot } from 'ts-graphviz';
import {
  Digraph as CoreDigraph,
  Graph as CoreGraph,
  Node as CoreNode,
  Edge as CoreEdge,
  Subgraph as CoreSubgraph,
} from '@ts-graphviz/core';

beforeAll(() => registerDefault());

describe('end-to-end DOT round trip', () => {
  it('preserves a complex graph through parse -> model -> AST -> DOT', () => {
    const dot = `digraph "G" {
  // top
  label = "Title";
  graph [
    bgcolor = "white";
  ];
  node [
    shape = "box";
  ];
  // first node
  "a" [
    label = "A";
  ];
  "b";
  "c";
  subgraph "cluster_1" {
    "d";
    "e";
    "d" -> "e";
  }
  "a" -> "b" -> "c";
  "a" -> { "d" "e" };
}`;
    const model = fromDot(dot);
    const again = toDot(model);
    // Re-parse both: structurally identical.
    const m1 = fromDot(dot);
    const m2 = fromDot(again);
    expect(m2.nodes.map((n) => n.id).sort()).toEqual(
      m1.nodes.map((n) => n.id).sort(),
    );
    expect(m2.edges.length).toBe(m1.edges.length);
    expect(m2.subgraphs.map((s) => s.id)).toEqual(
      m1.subgraphs.map((s) => s.id),
    );
    // Stable across repeated conversions.
    expect(toDot(fromDot(again))).toBe(again);
  });

  it('accepts a custom models context for custom model registration', () => {
    class CountingNode extends CoreNode {
      static created = 0;
      constructor(id: string, attributes?: ConstructorParameters<typeof CoreNode>[1]) {
        super(id, attributes);
        CountingNode.created++;
      }
    }
    const model = fromDot('digraph G { a; b; }', {
      convert: {
        models: {
          Graph: CoreGraph,
          Digraph: CoreDigraph,
          Subgraph: CoreSubgraph,
          Node: CountingNode,
          Edge: CoreEdge,
        },
      },
    }) as unknown as { getNode(id: string): unknown };
    // The custom Node constructor was wired through conversion options.
    expect(model.getNode('a')).toBeInstanceOf(CountingNode);
    expect(CountingNode.created).toBe(2);
  });
});
