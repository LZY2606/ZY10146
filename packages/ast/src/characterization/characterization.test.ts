import { registerDefault } from '@ts-graphviz/core';
import { Digraph, Graph } from '@ts-graphviz/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { fromModel } from '../model-shim/from-model/from-model.js';
import { stringify } from '../dot-shim/printer/stringify.js';
import { parse } from '../dot-shim/parser/parse.js';
import { toModel } from '../model-shim/to-model/to-model.js';
import type {
  CommentASTNode,
  DotASTNode,
  EdgeASTNode,
  GraphASTNode,
  NodeASTNode,
  SubgraphASTNode,
} from '../types.js';

beforeAll(() => {
  registerDefault();
});

function toDot(model: Parameters<typeof fromModel>[0]): string {
  return stringify(fromModel(model));
}

describe('characterization: object order', () => {
  it('emits direct attributes, default attribute lists, nodes, subgraphs, edges in order', () => {
    const g = new Digraph('G');
    g.set('label', 'top');
    g.graph({ bgcolor: 'white' });
    g.node({ shape: 'box' });
    g.edge({ color: 'red' });
    g.createNode('a');
    g.createNode('b');
    g.createSubgraph('cluster_1');
    g.createEdge(['a', 'b']);
    expect(toDot(g)).toMatchInlineSnapshot(`
      "digraph "G" {
        label = "top";
        graph [
          bgcolor = "white";
        ];
        edge [
          color = "red";
        ];
        node [
          shape = "box";
        ];
        "a";
        "b";
        subgraph "cluster_1" {}
        "a" -> "b";
      }"
    `);
  });

  it('keeps insertion order for many nodes and edges', () => {
    const g = new Digraph('G');
    for (const id of ['z', 'y', 'x', 'a', 'm']) {
      g.createNode(id);
    }
    g.createEdge(['z', 'a']);
    g.createEdge(['a', 'm']);
    g.createEdge(['x', 'y']);
    expect(toDot(g)).toMatchInlineSnapshot(`
      "digraph "G" {
        "z";
        "y";
        "x";
        "a";
        "m";
        "z" -> "a";
        "a" -> "m";
        "x" -> "y";
      }"
    `);
  });

  it('preserves nested subgraph child order', () => {
    const g = new Digraph('G');
    const s = g.createSubgraph('cluster_s');
    s.set('label', 'S');
    s.createNode('n1');
    s.createNode('n2');
    s.createEdge(['n1', 'n2']);
    const inner = s.createSubgraph('cluster_inner');
    inner.createNode('deep');
    expect(toDot(g)).toMatchInlineSnapshot(`
      "digraph "G" {
        subgraph "cluster_s" {
          label = "S";
          "n1";
          "n2";
          subgraph "cluster_inner" {
            "deep";
          }
          "n1" -> "n2";
        }
      }"
    `);
  });
});

describe('characterization: comments', () => {
  it('places graph, node, edge, subgraph and attribute-list comments', () => {
    const g = new Digraph('G');
    g.comment = 'root graph comment';
    g.attributes.graph.comment = 'graph attrs comment';
    g.graph({ rankdir: 'LR' } as Parameters<typeof g.graph>[0]);
    const n = g.createNode('a');
    n.comment = 'node comment';
    n.attributes.set('label', 'A');
    const e = g.createEdge(['a', 'b']);
    e.comment = 'edge comment';
    const s = g.createSubgraph('cluster_x');
    s.comment = 'subgraph comment';
    s.createNode('c');
    expect(toDot(g)).toMatchInlineSnapshot(`
      "// root graph comment
      digraph "G" {
        // graph attrs comment
        graph [
          rankdir = "LR";
        ];
        // node comment
        "a" [
          label = "A";
        ];
        // subgraph comment
        subgraph "cluster_x" {
          "c";
        }
        // edge comment
        "a" -> "b";
      }"
    `);
  });

  it('round-trips leading comments from DOT onto the following element', () => {
    const dot = [
      'digraph "G" {',
      '  // the a node',
      '  "a" [',
      '    label = "A";',
      '  ];',
      '  // the edge',
      '  "a" -> "b" [',
      '    color = "red";',
      '  ];',
      '  // a cluster',
      '  subgraph "cluster_1" {',
      '    "c";',
      '  }',
      '}',
    ].join('\n');
    const model = toModel(parse(dot));
    expect(model.comment).toBeUndefined();
    expect(model.getNode('a')?.comment).toBe('the a node');
    expect(model.edges[0]?.comment).toBe('the edge');
    expect(model.subgraphs[0]?.comment).toBe('a cluster');
    // from-model groups children: nodes, subgraphs, then edges.
    const reordered = [
      'digraph "G" {',
      '  // the a node',
      '  "a" [',
      '    label = "A";',
      '  ];',
      '  // a cluster',
      '  subgraph "cluster_1" {',
      '    "c";',
      '  }',
      '  // the edge',
      '  "a" -> "b" [',
      '    color = "red";',
      '  ];',
      '}',
    ].join('\n');
    expect(toDot(model)).toBe(reordered);
  });
});

describe('characterization: default attributes', () => {
  it('emits non-empty graph/node/edge default attribute lists', () => {
    const g = new Graph('G');
    g.node({ shape: 'circle' });
    g.graph({ bgcolor: 'gray' });
    expect(toDot(g)).toMatchInlineSnapshot(`
      "graph "G" {
        graph [
          bgcolor = "gray";
        ];
        node [
          shape = "circle";
        ];
      }"
    `);
  });

  it('omits empty default attribute lists', () => {
    const g = new Digraph('G');
    g.node({ shape: 'box' });
    expect(toDot(g)).toMatchInlineSnapshot(`
      "digraph "G" {
        node [
          shape = "box";
        ];
      }"
    `);
  });
});

describe('characterization: edge chains', () => {
  it('keeps a chained edge as a single Edge node with ordered targets', () => {
    const ast = parse('digraph G { a -> b -> c -> d; }') as DotASTNode;
    const graph = ast.children.find(
      (c): c is GraphASTNode => c.type === 'Graph',
    );
    const edge = graph!.children.find(
      (c): c is EdgeASTNode => c.type === 'Edge',
    );
    expect(edge).toBeDefined();
    expect(edge!.targets.map((t) => t.type)).toEqual([
      'NodeRef',
      'NodeRef',
      'NodeRef',
      'NodeRef',
    ]);
    expect(edge!.targets.map((t) => (t.type === 'NodeRef' ? t.id.value : '')))
      .toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
        "d",
      ]
    `);
    const model = toModel(ast);
    expect(model.edges).toHaveLength(1);
    expect(stringify(fromModel(model))).toMatchInlineSnapshot(`
      "digraph "G" {
        "a" -> "b" -> "c" -> "d";
      }"
    `);
  });

  it('converts node ref groups and ports', () => {
    const g = new Digraph('G');
    g.createEdge([
      { id: 'a', port: 'p1', compass: 'ne' },
      [
        { id: 'b', port: 'p2' },
        { id: 'c' },
      ],
    ]);
    expect(toDot(g)).toMatchInlineSnapshot(`
      "digraph "G" {
        "a":"p1":"ne" -> {"b":"p2" "c"};
      }"
    `);
  });
});

describe('characterization: anonymous subgraphs', () => {
  it('prints anonymous subgraphs as statements without id', () => {
    const ast = parse(
      'digraph G { { a; b; } }',
    ) as DotASTNode;
    const graph = ast.children.find(
      (c): c is GraphASTNode => c.type === 'Graph',
    );
    const sub = graph!.children.find(
      (c): c is SubgraphASTNode => c.type === 'Subgraph',
    );
    expect(sub).toBeDefined();
    expect(sub!.id).toBeUndefined();
    const model = toModel(ast);
    expect(model.subgraphs[0]?.id).toBeUndefined();
    expect(stringify(fromModel(model))).toMatchInlineSnapshot(`
      "digraph "G" {
        subgraph {
          "a";
          "b";
        }
      }"
    `);
  });

  it('prints deeply nested anonymous subgraphs with explicit subgraph keyword', () => {
    const dot = 'digraph G { { { "x"; } } }';
    const model = toModel(parse(dot));
    expect(model.subgraphs[0]?.subgraphs[0]?.nodes[0]?.id).toBe('x');
    expect(toDot(model)).toMatchInlineSnapshot(`
      "digraph "G" {
        subgraph {
          subgraph {
            "x";
          }
        }
      }"
    `);
  });
});

describe('characterization: model to AST shape', () => {
  it('keeps attribute statements, assignments and comments as distinct node kinds', () => {
    const g = new Digraph('G');
    g.set('rankdir', 'LR');
    g.node({ shape: 'box' });
    const n = g.createNode('a');
    n.comment = 'hello';
    n.attributes.set('label', 'A');
    const ast = fromModel(g) as DotASTNode;
    const graph = ast.children.find(
      (c): c is GraphASTNode => c.type === 'Graph',
    )!;
    expect(
      graph.children.map((c) => c.type),
    ).toMatchInlineSnapshot(`
      [
        "Attribute",
        "AttributeList",
        "Comment",
        "Node",
      ]
    `);
    const nodeIndex = graph.children.findIndex(
      (c): c is NodeASTNode => c.type === 'Node',
    );
    const leading = graph.children[nodeIndex - 1] as CommentASTNode;
    expect(leading.type).toBe('Comment');
    expect(leading.value).toBe('hello');
    const node = graph.children[nodeIndex] as NodeASTNode;
    expect(node.children.map((c) => c.type)).toEqual(['Attribute']);
  });
});
