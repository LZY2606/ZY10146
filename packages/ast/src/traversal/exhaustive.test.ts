/**
 * Compile-time exhaustiveness guarantees.
 *
 * These assertions only exist at the type level. If a new AST node `type` is
 * added to {@link ASTNode} (and therefore to {@link ASTNodeKind}) without
 * updating the classifier / slot table, `tsc` fails here.
 */
import { describe, expect, it } from 'vitest';
import { astSlotBuilders } from './ast-adapter.js';
import { classifyASTNode, type ASTNodeKind } from './ast-nodes.js';
import { assertNever, type NodeKindRecord } from '@ts-graphviz/common/internal/traversal';
import type { ASTNode } from '../types.js';

describe('AST traversal exhaustiveness (type level)', () => {
  it('classifies every AST kind', () => {
    // Every key must be present; adding a kind forces an entry.
    const table: NodeKindRecord<ASTNodeKind, (node: never) => unknown> = {
      Literal: classifyASTNode,
      Dot: classifyASTNode,
      Graph: classifyASTNode,
      Attribute: classifyASTNode,
      Comment: classifyASTNode,
      AttributeList: classifyASTNode,
      NodeRef: classifyASTNode,
      NodeRefGroup: classifyASTNode,
      Edge: classifyASTNode,
      Node: classifyASTNode,
      Subgraph: classifyASTNode,
    };
    expect(Object.keys(table).length).toBe(11);

    // The slot builder record must cover every kind with the same set of
    // keys; a missing kind is a compile error in the satisfies clause inside
    // ast-adapter, and this runtime assertion guards key cardinality.
    const slotKinds = Object.keys(astSlotBuilders).sort();
    expect(slotKinds).toEqual(Object.keys(table).sort());
  });

  it('assertNever rejects any non-never value only in unreachable code', () => {
    const reachable = (kind: ASTNodeKind): number => {
      switch (kind) {
        case 'Literal':
        case 'Dot':
        case 'Graph':
        case 'Attribute':
        case 'Comment':
        case 'AttributeList':
        case 'NodeRef':
        case 'NodeRefGroup':
        case 'Edge':
        case 'Node':
        case 'Subgraph':
          return 1;
        default:
          // If a kind is missing above, `kind` is not `never` and this line
          // fails to compile.
          return assertNever(kind) as never;
      }
    };
    expect(reachable('Literal')).toBe(1);
  });
});

// Reference the AST node type so tooling keeps the import.
export type { ASTNode };
