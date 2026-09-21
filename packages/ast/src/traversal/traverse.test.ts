import { describe, expect, it } from 'vitest';
import { createElement } from '../builder/create-element.js';
import { parse } from '../dot-shim/parser/parse.js';
import { stringify } from '../dot-shim/printer/stringify.js';
import type { DotASTNode } from '../types.js';
import { traverseAST, transformAST } from './traverse.js';

describe('traverseAST', () => {
  it('visits all node kinds with a correct parent path', () => {
    const ast = parse(
      'digraph G { a -> b; a [label="A"]; { c; d; } graph [rankdir=LR]; /* x */ a=b; }',
    ) as DotASTNode;
    const kinds: string[] = [];
    let maxDepth = 0;
    traverseAST(ast, {
      enter(c) {
        kinds.push(c.kind);
        maxDepth = Math.max(maxDepth, c.depth);
        if (c.kind === 'Attribute') {
          expect(c.parent?.kind).toMatch(/Node|Graph|AttributeList|Edge/);
        }
      },
    });
    for (const kind of [
      'Dot',
      'Graph',
      'Edge',
      'Node',
      'Subgraph',
      'Comment',
      'Attribute',
      'AttributeList',
      'Literal',
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(maxDepth).toBeGreaterThanOrEqual(3);
  });

  it('enumerates edge targets in stable order including NodeRefGroup', () => {
    const ast = parse('digraph G { a -> { b c } -> d; }') as DotASTNode;
    const targetKinds: string[] = [];
    traverseAST(ast, {
      enter(c) {
        if (c.parent?.kind === 'Edge' && c.slot?.name === 'targets') {
          targetKinds.push(c.kind);
        }
      },
    });
    expect(targetKinds).toEqual(['NodeRef', 'NodeRefGroup', 'NodeRef']);
  });

  it('keeps anonymous subgraph and edge targets as distinct kinds', () => {
    const ast = parse('digraph G { { c; } a -> b; }') as DotASTNode;
    const kinds = new Set<string>();
    traverseAST(ast, { enter: (c) => kinds.add(c.kind) });
    expect(kinds.has('Subgraph')).toBe(true);
    expect(kinds.has('NodeRef')).toBe(true);
  });
});

describe('transformAST', () => {
  it('removes all Comment nodes without skipping siblings', () => {
    const ast = parse('digraph G { /* c */ a; // d\n b; }') as DotASTNode;
    transformAST(ast, {
      enter(c) {
        if (c.kind === 'Comment') c.remove();
      },
    });
    const out = stringify(ast);
    expect(out).not.toContain('/*');
    expect(out).not.toContain('//');
    expect(out).toContain('a;');
    expect(out).toContain('b;');
  });

  it('replaces one node with several nodes', () => {
    const ast = parse('digraph G { a; b; }') as DotASTNode;
    transformAST(ast, {
      enter(c) {
        if (c.kind === 'Node' && c.node.id.value === 'a') {
          c.replaceWith([
            createElement(
              'Comment',
              { kind: 'Slash', value: 'split' },
              [],
            ),
            c.node,
          ]);
        }
      },
    });
    expect(stringify(ast)).toContain('// split');
  });

  it('inserts a sibling node once without revisiting it', () => {
    const ast = parse('digraph G { a; }') as DotASTNode;
    let visits = 0;
    transformAST(ast, {
      enter(c) {
        if (c.kind === 'Node') {
          if (c.node.id.value === 'marker') visits++;
          if (c.node.id.value === 'a') {
              c.insertAfter([
              createElement(
                'Node',
                {
                  id: createElement(
                    'Literal',
                    { value: 'marker', quoted: true },
                    [],
                  ),
                },
                [],
              ),
            ]);
          }
        }
      },
    });
    expect(visits).toBe(1);
    expect(stringify(ast)).toMatch(/a;[\s\S]*"marker";/);
  });

  it('clears shared path state when a visitor throws', () => {
    const ast1 = parse('digraph G { a; b; }') as DotASTNode;
    const boom = new Error('boom');
    expect(() =>
      traverseAST(ast1, {
        enter(c) {
          if (c.kind === 'Node' && c.node.id.value === 'b') throw boom;
        },
      }),
    ).toThrow(boom);

    const ast2 = parse('digraph G { x; }') as DotASTNode;
    const depths: number[] = [];
    expect(() =>
      traverseAST(ast2, {
        enter(c) {
          depths.push(c.depth);
        },
      }),
    ).not.toThrow();
    expect(depths[0]).toBe(0);
  });
});
