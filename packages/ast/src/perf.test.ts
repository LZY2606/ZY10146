import { visitModel } from '@ts-graphviz/common';
import { Digraph, registerDefault } from '@ts-graphviz/core';
import { describe, expect, it } from 'vitest';
import { parse } from './dot-shim/parser/parse.js';
import { stringify } from './dot-shim/printer/stringify.js';
import { fromModel } from './model-shim/from-model/from-model.js';
import { toModel } from './model-shim/to-model/to-model.js';
import { visitAST } from './traversal/visit-ast.js';

registerDefault();

function buildWideGraph(nodes: number, edges: number): Digraph {
  const g = new Digraph('Big');
  for (let i = 0; i < nodes; i++) {
    g.createNode(`n${i}`, { label: `Node ${i}` } as never);
  }
  for (let i = 0; i < edges; i++) {
    g.createEdge([`n${i % nodes}`, `n${(i + 1) % nodes}`], {
      label: `e${i}`,
    } as never);
  }
  return g;
}

describe('large graph performance', () => {
  it('converts and prints a large graph within a linear-time budget', () => {
    const N = 5000;
    const g = buildWideGraph(N, N * 2);

    let ast!: ReturnType<typeof fromModel>;
    const t0 = performance.now();
    ast = fromModel(g, { maxASTNodes: 0 });
    const t1 = performance.now();
    const dot = stringify(ast);
    const t2 = performance.now();

    // Traversal must be linear; generous upper bound to avoid flaky CI.
    expect(t1 - t0).toBeLessThan(3000);
    expect(t2 - t1).toBeLessThan(3000);
    expect(dot).toContain('n4999');

    // Round trip parse -> model should also be linear.
    const t3 = performance.now();
    const reparsed = parse(dot, { maxASTNodes: 0 });
    const model = toModel(reparsed);
    const t4 = performance.now();
    expect(model.nodes).toHaveLength(N);
    expect(t4 - t3).toBeLessThan(5000);

    // Visitors over the large AST/model stay well bounded.
    let count = 0;
    visitAST(ast, {
      enter: () => {
        count += 1;
      },
    });
    expect(count).toBeGreaterThan(N);
    let mcount = 0;
    visitModel(g, {
      enter: () => {
        mcount += 1;
      },
    });
    expect(mcount).toBeGreaterThan(N);
  }, 60000);
});
