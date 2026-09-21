import { SKIP, STOP } from '@ts-graphviz/common';
import { describe, expect, it } from 'vitest';
import { createElement } from '../builder/create-element.js';
import { parse } from '../dot-shim/parser/parse.js';
import { stringify } from '../dot-shim/printer/stringify.js';
import { astKind, transformAST, visitAST } from './index.js';

describe('AST visitor', () => {
  it('reports the parent path and stable slot/index', () => {
    const ast = parse('digraph G { subgraph cluster_x { a; } a -> b; }');
    const seen: string[] = [];
    visitAST(ast, {
      enter(ctx) {
        seen.push(
          `${astKind(ctx.node)}:${ctx.slot ?? '-'}[${ctx.index}] depth=${ctx.path.length}`,
        );
      },
    });
    expect(seen[0]).toBe('Document:-[-1] depth=1');
    const graphEntry = seen.find((line) => line.startsWith('Graph:children'));
    expect(graphEntry).toBe('Graph:children[0] depth=2');
    const subEntry = seen.find((line) => line.startsWith('Subgraph:children'));
    expect(subEntry).toContain('depth=3');
  });

  it('default visitor is read only (no mutation methods)', () => {
    const ast = parse('digraph G { a; }');
    visitAST(ast, {
      enter(ctx) {
        expect(ctx).not.toHaveProperty('delete');
        expect(ctx).not.toHaveProperty('replace');
        expect(ctx).not.toHaveProperty('insertBefore');
        void SKIP;
        void STOP;
      },
    });
  });

  it('deletes the current node while walking and keeps sibling order', () => {
    const ast = parse('digraph G { a; b; c; }');
    transformAST(ast, {
      enter(ctx) {
        if (ctx.node.type === 'Node' && ctx.node.id.value === 'b') {
          ctx.delete();
        }
      },
    });
    const out = stringify(ast);
    expect(out).not.toContain('"b"');
    expect(out).toContain('a;');
    expect(out).toContain('c;');
    expect(out.indexOf('c;')).toBeGreaterThan(out.indexOf('a;'));
  });

  it('replaces one statement with multiple statements and visits each', () => {
    const ast = parse('digraph G { a; }');
    const visited: string[] = [];
    transformAST(ast, {
      enter(ctx) {
        if (ctx.node.type === 'Node' && ctx.node.id.value === 'a') {
          ctx.replace(
            createElement(
              'Node',
              { id: createElement('Literal', { value: 'x', quoted: true }) },
              [],
            ),
            createElement(
              'Node',
              { id: createElement('Literal', { value: 'y', quoted: true }) },
              [],
            ),
          );
        }
        if (ctx.node.type === 'Node') {
          visited.push(ctx.node.id.value);
        }
      },
    });
    expect(visited).toContain('x');
    expect(visited).toContain('y');
    expect(stringify(ast)).toContain('"x";');
    expect(stringify(ast)).toContain('"y";');
  });

  it('inserts siblings and visits them exactly once without index skipping', () => {
    const ast = parse('digraph G { b; c; }');
    const visited: string[] = [];
    transformAST(ast, {
      enter(ctx) {
        if (ctx.node.type === 'Node') {
          visited.push(ctx.node.id.value);
        }
        if (ctx.node.type === 'Node' && ctx.node.id.value === 'b') {
          ctx.insertAfter(
            createElement(
              'Node',
              { id: createElement('Literal', { value: 'b2', quoted: true }) },
              [],
            ),
          );
        }
      },
    });
    expect(visited).toEqual(['b', 'b2', 'c']);
  });

  it('recovers cleanly when a visitor throws mid traversal', () => {
    const ast = parse('digraph G { a; subgraph { b; } c; }');
    const error = new Error('boom');
    expect(() =>
      visitAST(ast, {
        enter(ctx) {
          if (ctx.node.type === 'Node' && ctx.node.id.value === 'b') {
            throw error;
          }
        },
      }),
    ).toThrow(error);

    // Subsequent traversal sees a fresh empty path starting at the root.
    let firstPath = -1;
    visitAST(ast, {
      enter(ctx) {
        if (firstPath === -1) {
          firstPath = ctx.path.length;
        }
      },
    });
    expect(firstPath).toBe(1);
  });

  it('keeps distinct kinds: assignment vs attribute list vs comment vs endpoint', () => {
    const ast = parse(
      'digraph G { label="x"; /* c */ node [shape=box]; a -> b:ne; }',
    );
    const kinds: string[] = [];
    visitAST(ast, {
      enter(ctx) {
        kinds.push(ctx.kind);
      },
    });
    expect(kinds).toContain('Attribute');
    expect(kinds).toContain('AttributeList');
    expect(kinds).toContain('Comment');
    expect(kinds).toContain('NodeRef');
    expect(kinds).toContain('Edge');
  });
});

import {
  analyzeAST,
  collectEdgeStatements,
  collectNodeStatements,
} from './analyze.js';

describe('AST analysis tools share the traversal skeleton', () => {
  it('counts each element kind and reports nesting depth', () => {
    const ast = parse(
      'digraph G { // c\n  subgraph cluster_s { x; } { y; } x -> y -> {a b}; node [shape=box]; label="t"; }',
    );
    const analysis = analyzeAST(ast);
    expect(analysis.graphs).toBe(1);
    expect(analysis.subgraphs).toBe(2);
    expect(analysis.anonymousSubgraphs).toBe(1);
    expect(analysis.edges).toBe(1);
    expect(analysis.attributeLists).toBe(1);
    expect(analysis.comments).toBeGreaterThanOrEqual(1);
    expect(analysis.maxDepth).toBe(2);
    expect(collectNodeStatements(ast).map((n) => n.id.value)).toEqual([
      'x',
      'y',
    ]);
    expect(collectEdgeStatements(ast)).toHaveLength(1);
  });
});
