import {
  type EdgeModel,
  type RootGraphModel,
  RootModelsContext,
  type SubgraphModel,
} from '@ts-graphviz/common';
import { registerDefault } from '@ts-graphviz/core';
import { describe, expect, it } from 'vitest';
import { parse } from './dot-shim/parser/parse.js';
import { stringify } from './dot-shim/printer/stringify.js';
import { fromModel } from './model-shim/from-model/from-model.js';
import { toModel } from './model-shim/to-model/to-model.js';

registerDefault();

describe('characterization: round trip ordering', () => {
  function build(): RootGraphModel {
    const root = new RootModelsContext.Digraph('G');
    const anyRoot = root as unknown as {
      set(k: string, v: string): void;
      attributes: Record<string, { set(k: string, v: string): void }>;
    };
    anyRoot.set('label', 'root');
    anyRoot.attributes.graph.set('bgcolor', 'white');
    anyRoot.attributes.edge.set('color', 'blue');
    anyRoot.attributes.node.set('shape', 'box');
    const a = root.createNode('a');
    (a.attributes as unknown as { set(k: string, v: string): void }).set(
      'label',
      'A',
    );
    const sub = root.createSubgraph('cluster_1');
    sub.createNode('b');
    sub.createEdge(['b', 'a']);
    root.createEdge(['a', 'b'], { color: 'red' } as never);
    root.comment = 'root comment';
    return root;
  }

  it('fromModel emits statements in the documented stable order', () => {
    const dot = stringify(fromModel(build()));
    expect(dot).toBe(
      [
        '// root comment',
        'digraph "G" {',
        '  label = "root";',
        '  graph [',
        '    bgcolor = "white";',
        '  ];',
        '  edge [',
        '    color = "blue";',
        '  ];',
        '  node [',
        '    shape = "box";',
        '  ];',
        '  "a" [',
        '    label = "A";',
        '  ];',
        '  subgraph "cluster_1" {',
        '    "b";',
        '    "b" -> "a";',
        '  }',
        '  "a" -> "b" [',
        '    color = "red";',
        '  ];',
        '}',
      ].join('\n'),
    );
  });

  it('preserves comments when parsing DOT back to a model', () => {
    const dot = [
      '// leading graph comment',
      'digraph G {',
      '  // standalone comment',
      '  a [label="A"];',
      '  /* block comment */',
      '  a -> b;',
      '}',
    ].join('\n');
    const model = toModel(parse(dot));
    expect(model.comment).toBe('leading graph comment');
    const nodeA = model.getNode('a');
    expect(nodeA?.comment).toBe('standalone comment');
    expect(model.edges[0].comment).toBe('block comment');
    expect(
      (nodeA?.attributes as unknown as { get(k: string): unknown }).get(
        'label',
      ),
    ).toBe('A');
  });

  it('keeps attribute statement, assignment and attribute list distinct', () => {
    const dot = [
      'digraph G {',
      '  label = "x";',
      '  node [shape=box];',
      '  a;',
      '}',
    ].join('\n');
    const ast = parse(dot);
    const graph = ast.children.find((c) => c.type === 'Graph')!;
    expect(graph.children.map((c) => c.type)).toEqual([
      'Attribute',
      'AttributeList',
      'Node',
    ]);
    const list = graph.children[1];
    expect(list.type).toBe('AttributeList');
    if (list.type === 'AttributeList') {
      expect(list.kind).toBe('Node');
      expect(list.children[0].type).toBe('Attribute');
    }
  });

  it('keeps an edge chain as one edge with an ordered target tuple', () => {
    const dot = 'digraph G { a -> b -> {c d}; }';
    const ast = parse(dot);
    const graph = ast.children.find((c) => c.type === 'Graph')!;
    expect(graph.children).toHaveLength(1);
    expect(graph.children[0].type).toBe('Edge');
    const model = toModel(ast) as RootGraphModel;
    expect(model.edges).toHaveLength(1);
    const edge = model.edges[0] as EdgeModel;
    expect(edge.targets).toHaveLength(3);
    expect((edge.targets[0] as { id: string }).id).toBe('a');
    expect((edge.targets[1] as { id: string }).id).toBe('b');
    expect(Array.isArray(edge.targets[2])).toBe(true);
    expect((edge.targets[2] as { id: string }[]).map((n) => n.id)).toEqual([
      'c',
      'd',
    ]);
    expect(stringify(fromModel(model))).toBe(
      'digraph "G" {\n  "a" -> "b" -> {"c" "d"};\n}',
    );
  });

  it('round trips anonymous subgraphs', () => {
    const dot = 'digraph G { { a; b; } a -> b; }';
    const ast = parse(dot);
    const model = toModel(ast);
    expect(model.subgraphs).toHaveLength(1);
    const sub = model.subgraphs[0] as SubgraphModel;
    expect(sub.id).toBeUndefined();
    expect(sub.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(stringify(fromModel(model))).toBe(
      'digraph "G" {\n  subgraph {\n    "a";\n    "b";\n  }\n  "a" -> "b";\n}',
    );
  });

  it('currently drops comments preceding a default attribute list (pinned behaviour)', () => {
    const dot = [
      'digraph G {',
      '  // default node style',
      '  node [shape=box];',
      '}',
    ].join('\n');
    const reparsed = toModel(parse(dot));
    expect(reparsed.attributes.node.comment).toBeUndefined();
  });
});
