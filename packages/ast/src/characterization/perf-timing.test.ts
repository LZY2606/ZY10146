import { registerDefault, Digraph } from 'ts-graphviz';
import { parse, stringify, fromModel, toModel } from 'ts-graphviz/ast';
import { describe, expect, test } from 'vitest';

registerDefault();

function makeWideGraph(n: number) {
  const g = new Digraph('G');
  for (let i = 0; i < n; i++) g.createNode(`n${i}`);
  for (let i = 0; i < n - 1; i++) g.createEdge([`n${i}`, `n${i + 1}`]);
  g.createSubgraph('cluster_1');
  return g;
}
function makeDeepGraph(depth: number) {
  const g = new Digraph('G');
  let cur = g.createSubgraph('cluster_0');
  for (let i = 1; i < depth; i++) cur = cur.createSubgraph(`cluster_${i}`);
  cur.createNode('leaf');
  return g;
}

describe('large graph performance', () => {
  test('wide(5000) conversions stay linear and fast', () => {
    const wide = makeWideGraph(5000);
    const wideDot = stringify(fromModel(wide));
    const wideAst = fromModel(wide);
    const time = (label: string, fn: () => unknown, runs = 15, maxMs: number) => {
      fn();
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const s = performance.now();
        fn();
        times.push(performance.now() - s);
      }
      times.sort((a, b) => a - b);
      const median = times[Math.floor(runs / 2)];
      // eslint-disable-next-line no-console
      console.log(label, 'median', median.toFixed(2), 'ms');
      expect(median).toBeLessThan(maxMs);
    };
    // Baseline (pre-refactor): fromModel ~9.6ms, stringify ~29ms,
    // parse ~66ms, toModel ~69ms on this machine. Allow generous headroom.
    time('fromModel wide(5000)      ', () => fromModel(wide), 15, 120);
    time('stringify wide(5000)      ', () => stringify(wideAst), 15, 80);
    time('parse wide(5000) dot      ', () => parse(wideDot), 8, 150);
    time('toModel wide(5000)        ', () => toModel(parse(wideDot)), 8, 150);
  });

  test('deep(2000) conversion no longer blows the stack and is fast', () => {
    const deep = makeDeepGraph(2000);
    // Pre-refactor this threw RangeError at depth ~1000 and took ~3500ms at
    // depth 400. The walker-based skeleton is iterative.
    const s = performance.now();
    const dot = stringify(fromModel(deep));
    const elapsed = performance.now() - s;
    // eslint-disable-next-line no-console
    console.log('fromModel+stringify deep(2000)', elapsed.toFixed(2), 'ms');
    expect(elapsed).toBeLessThan(1000);
    expect(dot).toContain('cluster_1999');

    const ast = fromModel(deep);
    const t2 = performance.now();
    toModel(ast);
    // eslint-disable-next-line no-console
    console.log('toModel deep(2000)', (performance.now() - t2).toFixed(2), 'ms');
  });
});
