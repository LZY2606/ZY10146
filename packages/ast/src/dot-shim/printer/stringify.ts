import type { ASTNode } from '../../types.js';
import { printWithWalker } from './printer-walker.js';
import type { PrintOptions } from './types.js';

/**
 * stringify converts a Graphviz AST node into a DOT language string.
 *
 * The traversal skeleton and child ordering come from the shared AST adapter;
 * only token emission lives in the printer.
 *
 * @param ast Graphviz AST node to convert.
 * @param options PrintOptions object containing formatting options.
 * @returns A string in DOT language.
 * @group Convert AST to DOT
 */
export function stringify(ast: ASTNode, options?: PrintOptions): string {
  return printWithWalker(ast, options ?? {});
}
