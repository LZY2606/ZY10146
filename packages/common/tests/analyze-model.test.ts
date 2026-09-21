import { registerDefault, Digraph } from 'ts-graphviz';
import { describe, expect, it, beforeAll } from 'vitest';
import { analyzeModel } from '../src/traversal/index.js';

beforeAll(() => registerDefault());

describe('analyzeModel (shared analysis tool)', () => {
  it('counts graph objects, attributes, comments and cluster depth', () => {
    const g = new Digraph('G');
    g.set('rankdir', 'LR');
    g.comment = 'root';
    g.node({ shape: 'box' });
    const a = g.createNode('a');
    a.comment = 'node a';
    a.attributes.set('label', 'A');
    g.createNode('b');
    g.createEdge(['a', 'b']).comment = 'edge';
    const s = g.createSubgraph('cluster_x');
    s.createNode('c');
    s.createSubgraph('cluster_y');

    const stats = analyzeModel(g);
    expect(stats.graphs).toBe(1);
    expect(stats.subgraphs).toBe(2);
    expect(stats.nodes).toBe(3);
    expect(stats.edges).toBe(1);
    expect(stats.attributeLists).toBeGreaterThanOrEqual(1);
    expect(stats.attributeAssignments).toBeGreaterThanOrEqual(3);
    expect(stats.comments).toBe(3); // root, node, edge
    expect(stats.maxDepth).toBeGreaterThanOrEqual(2);
  });
});
