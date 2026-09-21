import { registerDefault } from '@ts-graphviz/core';
import { Digraph } from '@ts-graphviz/core';
import type {
  AttributeListModel,
  DotObjectModel,
  EdgeModel,
  NodeModel,
} from '@ts-graphviz/common';
import type {
  ConvertFromModelContext,
  ConvertFromModelPlugin,
  ModelToAST,
} from '../model-shim/from-model/types.js';
import {
  fromModel,
  parse,
  stringify,
  toModel,
  traverseAST,
  transformAST,
} from '../ast.js';
import { FromModelConverter } from '../model-shim/from-model/converter.js';
import { describe, expect, it, beforeAll } from 'vitest';
import type { DotASTNode } from '../types.js';

beforeAll(() => {
  registerDefault();
});

describe('custom model registration', () => {
  it('converts a graph built with a custom registered model class', () => {
    class CustomNode {
      $$type = 'Node' as const;
      id: string;
      comment?: string;
      attributes = {
        size: 0,
        values: [['label', 'custom']] as unknown as never,
        get() {
          return 'custom';
        },
      } as unknown as NodeModel['attributes'];
      port() {
        return { id: this.id };
      }
      constructor(id: string) {
        this.id = id;
      }
    }

    const g = new Digraph('G');
    g.addNode(new CustomNode('x') as unknown as NodeModel);
    const out = stringify(fromModel(g));
    expect(out).toContain('"x"');
    expect(out).toContain('label = "custom"');
  });

  it('honors a custom from-model plugin registered on the converter', () => {
    const marker: DotObjectModel = { $$type: 'Node' } as NodeModel;
    const plugin: ConvertFromModelPlugin<DotObjectModel> = {
      match: (m) => m === marker,
      convert(ctx: ConvertFromModelContext) {
        return ctx.createElement(
          'Node',
          {
            id: ctx.createElement(
              'Literal',
              { value: 'plug', quoted: true },
              [],
            ),
          },
          [],
        ) as ModelToAST<typeof marker>;
      },
    };
    const converter = new FromModelConverter();
    converter.use(plugin);
    const ast = converter.convert(marker);
    expect(stringify(ast as never)).toContain('"plug"');
  });
});

describe('deep subgraph traversal', () => {
  const buildDeepModel = (depth: number) => {
    const g = new Digraph('G');
    let cur = g.createSubgraph('cluster_0');
    for (let i = 1; i < depth; i++) cur = cur.createSubgraph(`cluster_${i}`);
    cur.createNode('leaf');
    return g;
  };

  it('walks and prints deeply nested subgraphs without call-stack growth', () => {
    const depth = 5000;
    const model = buildDeepModel(depth);
    const ast = fromModel(model);
    let subgraphCount = 0;
    expect(() =>
      traverseAST(ast, {
        enter(c) {
          if (c.kind === 'Subgraph') subgraphCount++;
        },
      }),
    ).not.toThrow();
    expect(subgraphCount).toBe(depth);
    // fromModel and stringify (both walker-based) must survive the depth.
    expect(() => stringify(fromModel(model))).not.toThrow();
    // toModel over the walker-built AST also survives.
    expect(() => toModel(ast as never)).not.toThrow();
  });

  it('the recursive parser has its own (pre-existing) depth limit', () => {
    // Documenting the boundary: parsing is a generated recursive parser and is
    // not part of the traversal skeleton being refactored here.
    const shallow = parse('digraph G { { { "leaf"; } } }');
    let subgraphCount = 0;
    traverseAST(shallow, {
      enter(c) {
        if (c.kind === 'Subgraph') subgraphCount++;
      },
    });
    expect(subgraphCount).toBe(2);
  });
});

describe('transform: delete current node', () => {
  it('removes nodes matched in enter and keeps siblings', () => {
    const ast = parse('digraph G { a; b; c; }') as DotASTNode;
    transformAST(ast, {
      enter(c) {
        if (c.kind === 'Node' && c.node.id.value === 'b') {
          c.remove();
        }
      },
    });
    const out = stringify(ast);
    expect(out).toContain('a');
    expect(out).toContain('c');
    expect(out).not.toContain('"b"');
    expect(out).not.toMatch(/\bb\b\s*;/);
  });

  it('removes a nested subgraph and its whole subtree', () => {
    const ast = parse(
      'digraph G { a; subgraph cluster_x { b; c; } d; }',
    ) as DotASTNode;
    transformAST(ast, {
      enter(c) {
        if (c.kind === 'Subgraph' && c.node.id?.value === 'cluster_x') {
          c.remove();
        }
      },
    });
    const out = stringify(ast);
    expect(out).not.toContain('cluster_x');
    expect(out).not.toContain('"b"');
    expect(out).not.toContain('"c"');
    expect(out).toContain('a');
    expect(out).toContain('d');
  });
});

describe('read-only traverse cannot mutate', () => {
  it('does not expose transform methods', () => {
    const ast = parse('digraph G { a; }') as DotASTNode;
    traverseAST(ast, {
      enter(c) {
        const readonly = c as unknown as {
          remove?: unknown;
          replaceWith?: unknown;
        };
        expect(readonly.remove).toBeUndefined();
        expect(readonly.replaceWith).toBeUndefined();
      },
    });
  });
});

// Re-exported types are referenced so unused-import elision does not drop them.
void (0 as unknown as AttributeListModel);
void (0 as unknown as EdgeModel);
