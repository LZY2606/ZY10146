/**
 * Shared internal traversal protocol: narrow visitor interfaces, the
 * representation-agnostic walker, and the adapter for the common model
 * interfaces. The AST adapter lives in `@ts-graphviz/ast` so dependencies stay
 * acyclic (core/common never import ast).
 *
 * @module
 * @group Traversal
 * @internal
 */

export * from './model-adapter.js';
export * from './model-nodes.js';
export * from './types.js';
export * from './visit-model.js';
export * from './walker.js';
