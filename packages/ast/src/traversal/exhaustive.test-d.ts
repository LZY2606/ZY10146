/**
 * Compile-time guarantee that adapters are exhaustive.
 *
 * These files are not executed; they assert (via the type system) that every
 * adapter switch covers the full node union. Adding a new AST `type` or
 * traversal kind makes these checks fail to compile until each adapter is
 * updated.
 *
 * Run implicitly as part of the package's strict type checking.
 *
 * @group AST Traversal
 */
import type { TraversalKind } from '@ts-graphviz/common';
import type { ASTNode } from '../types.js';
import { astKind, astSlots } from './ast-adapter.js';

declare const node: ASTNode;

// astKind must return a TraversalKind for every AST node without casts in the
// switch arms.
export const kind: TraversalKind = astKind(node);

// astSlots must accept every AST node.
export const slots = astSlots(node);

/**
 * If a new kind is added to TraversalKind, this mapped type grows a required
 * handler key, breaking any adapter that treats the classification as a fixed
 * string set.
 */
export type ExhaustiveKindHandler = {
  [K in TraversalKind]: true;
};

export const handlerComplete: ExhaustiveKindHandler = {
  Document: true,
  Graph: true,
  Subgraph: true,
  Node: true,
  Edge: true,
  AttributeList: true,
  Attribute: true,
  Comment: true,
  Literal: true,
  NodeRef: true,
  NodeRefGroup: true,
  EdgeTarget: true,
  AnonymousCluster: true,
};
