import {
  type TransformContext,
  type TransformingVisitor,
  TreeWalker,
  type VisitContext,
  type Visitor,
} from '@ts-graphviz/common';
import { type ModelTraversalNode, modelNodeAdapter } from './model-adapter.js';

/**
 * Context passed to read-only model visitors.
 *
 * @group Model Traversal
 */
export type ModelVisitContext = VisitContext<ModelTraversalNode>;

/**
 * Context passed to transforming model visitors.
 *
 * @group Model Traversal
 */
export type ModelTransformContext = TransformContext<ModelTraversalNode>;

/**
 * Read-only model visitor.
 *
 * @group Model Traversal
 */
export type ModelVisitor = Visitor<ModelTraversalNode>;

/**
 * Model visitor that may delete, replace or insert supported nodes.
 *
 * @group Model Traversal
 */
export type ModelTransformingVisitor = TransformingVisitor<ModelTraversalNode>;

/**
 * Traverse a DOT model read-only using the shared enter/leave protocol.
 *
 * @group Model Traversal
 */
export function visitModel(
  root: ModelTraversalNode,
  visitor: ModelVisitor,
): void {
  new TreeWalker(modelNodeAdapter).visit(root, visitor);
}

/**
 * Traverse a DOT model while allowing supported structural edits.
 *
 * @group Model Traversal
 */
export function transformModel(
  root: ModelTraversalNode,
  visitor: ModelTransformingVisitor,
): ModelTraversalNode | undefined {
  return new TreeWalker(modelNodeAdapter).transform(root, visitor);
}
