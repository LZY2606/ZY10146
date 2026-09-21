import type { ASTNode } from '../../types.js';
import { printWithWalker } from './printer-walker.js';
import type { PrintOptions } from './types.js';

/**
 * Printer converts an AST into a DOT string.
 *
 * The traversal skeleton and child ordering is shared with the rest of the
 * library via the AST adapter; this class remains as a thin, backward
 * compatible entry point.
 *
 * @group Convert AST to DOT
 */
export class Printer {
  /**
   * @param options Options used when generating the DOT string.
   */
  constructor(private options: PrintOptions = {}) {}

  /**
   * Generate a DOT string from an ASTNode.
   * @param ast The ASTNode to print.
   * @returns The generated DOT string.
   */
  public print(ast: ASTNode): string {
    return printWithWalker(ast, this.options);
  }
}
