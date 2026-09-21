import {
  Digraph,
  Edge as BaseEdge,
  Graph as BaseGraph,
  Node as BaseNode,
  registerDefault,
  Subgraph as BaseSubgraph,
} from 'ts-graphviz';
import { parse, toModel } from 'ts-graphviz/ast';
import { describe, expect, it } from 'vitest';
registerDefault();

class MyNode extends BaseNode {}
class MyEdge extends BaseEdge {}
class MyGraph extends BaseGraph {}
class MyDigraph extends Digraph {}
class MySubgraph extends BaseSubgraph {}

describe('custom models through parse/toModel', () => {
  it('uses registered custom constructors', () => {
    const ast = parse('digraph G { subgraph s { a; } a -> b; }');
    const g = toModel(ast, {
      models: {
        Node: MyNode,
        Edge: MyEdge,
        Graph: MyGraph,
        Digraph: MyDigraph,
        Subgraph: MySubgraph,
      },
    });
    expect(g).toBeInstanceOf(MyDigraph);
    expect(g.subgraphs[0].getNode('a')).toBeInstanceOf(MyNode);
    expect(g.edges[0]).toBeInstanceOf(MyEdge);
    expect(g.subgraphs[0]).toBeInstanceOf(MySubgraph);
  });
});
