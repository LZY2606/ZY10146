/**
 * Public AST traversal API.
 *
 * @module
 */
export {
  traverseAST,
  transformAST,
  type ASTVisitor,
  type ASTTransformVisitor,
  type ASTVisitContext,
  type ASTTransformVisitContext,
} from './traverse.js';
export type { ASTClassifiedNode, ASTNodeKind } from './ast-nodes.js';
