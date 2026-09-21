import {
  type TransformContext,
  type TransformingVisitor,
  TreeWalker,
  type VisitContext,
  type Visitor,
} from '@ts-graphviz/common';
import { type ASTTraversalNode, astNodeAdapter } from './ast-adapter.js';

/**
 * Context passed to read-only AST visitors.
 *
 * @group AST Traversal
 */
export type ASTVisitContext = VisitContext<ASTTraversalNode>;

/**
 * Context passed to transforming AST visitors.
 *
 * @group AST Traversal
 */
export type ASTTransformContext = TransformContext<ASTTraversalNode>;

/**
 * Read-only AST visitor.
 *
 * @group AST Traversal
 */
export type ASTVisitor = Visitor<ASTTraversalNode>;

/**
 * AST visitor that may delete, replace or insert nodes.
 *
 * @group AST Traversal
 */
export type ASTTransformingVisitor = TransformingVisitor<ASTTraversalNode>;

const walker = new TreeWalker<ASTTraversalNode>(astNodeAdapter);

/**
 * Traverse an AST read-only using the shared enter/leave protocol.
 *
 * The traversal reports the parent path, the owning slot and the stable child
 * index for every node.
 *
 * @group AST Traversal
 */
export function visitAST(root: ASTTraversalNode, visitor: ASTVisitor): void {
  walker.visit(root, visitor);
}

/**
 * Traverse an AST while allowing structural edits.
 *
 * Supports deleting the current node, replacing it with zero or many nodes,
 * and inserting siblings (visited exactly once) before or after it.
 *
 * @group AST Traversal
 */
export function transformAST(
  root: ASTTraversalNode,
  visitor: ASTTransformingVisitor,
): ASTTraversalNode | undefined {
  return new TreeWalker<ASTTraversalNode>(astNodeAdapter).transform(
    root,
    visitor,
  );
}
