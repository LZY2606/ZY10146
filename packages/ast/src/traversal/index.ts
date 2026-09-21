/**
 * AST traversal protocol: an exhaustive node adapter over the AST union plus
 * read-only and transforming visitors. Built on the narrow primitives in
 * `@ts-graphviz/common`.
 *
 * @module
 * @group AST Traversal
 */
export * from './ast-adapter.js';
export * from './visit-ast.js';
