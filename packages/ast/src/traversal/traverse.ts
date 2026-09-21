import {
  type TransformVisitContext,
  type VisitContext,
  type WalkOptions,
  type WalkResult,
  transformWalk,
  walk,
} from '@ts-graphviz/common/internal/traversal';
import type { ASTNode } from '../types.js';
import { astNodeAdapter } from './ast-adapter.js';
import type { ASTClassifiedNode, ASTNodeKind } from './ast-nodes.js';

/**
 * Maps each AST kind to its concrete node type inside a visit context.
 *
 * @group AST Traversal
 */
export type ASTNodeOfKind<K extends ASTNodeKind> = Extract<
  ASTClassifiedNode,
  { kind: K }
>['node'];

/**
 * Strongly typed, distributive read-only context for one AST kind. The union
 * distributes over {@link ASTNodeKind}, so narrowing on `context.kind` also
 * narrows `context.node` to the concrete AST node.
 *
 * @group AST Traversal
 */
export type ASTVisitContext = {
  [K in ASTNodeKind]: Omit<
    VisitContext<ASTNodeKind>,
    'kind' | 'node'
  > & {
    kind: K;
    node: ASTNodeOfKind<K>;
  };
}[ASTNodeKind];

/**
 * Strongly typed, distributive transform context for one AST kind.
 *
 * @group AST Traversal
 */
export type ASTTransformVisitContext = {
  [K in ASTNodeKind]: Omit<
    TransformVisitContext<ASTNodeKind>,
    'kind' | 'node'
  > & {
    kind: K;
    node: ASTNodeOfKind<K>;
  };
}[ASTNodeKind];

/** Read-only AST visitor. @group AST Traversal */
export interface ASTVisitor {
  enter?(context: ASTVisitContext): void;
  leave?(context: ASTVisitContext): void;
}

/** AST visitor with structural edit access. @group AST Traversal */
export interface ASTTransformVisitor {
  enter?(context: ASTTransformVisitContext): void;
  leave?(context: ASTTransformVisitContext): void;
}

/**
 * Traverse an AST depth-first with enter/leave callbacks.
 *
 * Read-only by default: visitors observe a live parent path
 * ({@link VisitContext.path}), stable child order and the current
 * {@link VisitContext.depth}. If a visitor throws, internal parent-stack
 * state is cleared before the error propagates, so a reused visitor never
 * observes stale state.
 *
 * @group AST Traversal
 */
export function traverseAST(
  root: ASTNode,
  visitor: ASTVisitor,
  options?: WalkOptions,
): void {
  walk(astNodeAdapter, root, visitor as never, options);
}

/**
 * Traverse an AST with structural edit access.
 *
 * Edit semantics (see {@link TransformVisitContext}):
 *
 * - `remove()` deletes the current node; its children are skipped and `leave`
 *   is not called.
 * - `replaceWith(nodes)` replaces the current node with one or more nodes;
 *   replacements are visited unless `{ visit: 'skip' }` is given.
 * - `insertBefore`/`insertAfter` add siblings (array slots only); inserted
 *   nodes are visited once, immediately after the current subtree, in document
 *   order.
 *
 * Every concrete node is visited at most once, so inserts cannot cause index
 * skipping or infinite loops.
 *
 * @group AST Traversal
 */
export function transformAST(
  root: ASTNode,
  visitor: ASTTransformVisitor,
  options?: WalkOptions,
): WalkResult {
  return transformWalk(astNodeAdapter, root, visitor as never, options);
}
