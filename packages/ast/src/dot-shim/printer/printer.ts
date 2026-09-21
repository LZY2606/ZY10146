import type { ASTNode } from '../../types.js';
import { defaultPlugins } from './plugins/index.js';
import type { PrintContext, PrintOptions, PrintPlugin } from './types.js';
import { printAST } from './walk-printer.js';

/**
 * Printer converts an AST into a DOT string.
 *
 * By default printing runs through the shared, iterative visitor skeleton
 * (see {@link printAST}), so deeply nested ASTs cannot grow the call stack.
 * A custom {@link PrintPlugin} registered with {@link Printer.use} opts the
 * instance into the legacy plugin-dispatch path so user renderers keep
 * working.
 *
 * @group Convert AST to DOT
 */
export class Printer {
  /** @internal */
  #plugins: PrintPlugin[] = [...defaultPlugins];

  /** @internal */
  #custom = false;

  /**
   * @param options Options to be used when generating the DOT string.
   */
  constructor(private options: PrintOptions = {}) {}

  /**
   * Register a custom print plugin. Once any custom plugin is registered the
   * printer uses the plugin-dispatch path for that instance.
   */
  public use(plugin: PrintPlugin): this {
    this.#plugins.unshift(plugin);
    this.#custom = true;
    return this;
  }

  /**
   * Generates a DOT string from an ASTNode.
   * @param ast The ASTNode to be converted into a DOT string.
   * @returns The DOT string generated from the ASTNode.
   */
  public print(ast: ASTNode): string {
    if (!this.#custom) {
      return printAST(ast, this.options);
    }
    return Array.from(this.toChunks(ast)).join('');
  }

  private toChunks(ast: ASTNode): Iterable<string> {
    const plugins = [...this.#plugins];
    const {
      indentSize = 2,
      indentStyle = 'space',
      endOfLine = 'lf',
    } = this.options;
    const EOL = endOfLine === 'crlf' ? '\r\n' : '\n';
    const PADDING = indentStyle === 'space' ? ' '.repeat(indentSize) : '\t';
    const context: PrintContext = {
      directed: true,
      EOL,
      *printChildren(children: ASTNode[]) {
        yield* indent(function* () {
          yield EOL;
          yield* context.join(children, EOL);
        });
        yield EOL;
      },
      *print(a: ASTNode) {
        for (const plugin of plugins) {
          if (plugin.match(a)) {
            yield* plugin.print(this, a);
            return;
          }
        }
        throw new Error(
          `No matching plugin found for AST node: ${JSON.stringify(a)}`,
        );
      },
      *join(array: ASTNode[], separator: string) {
        const childrenLength = array.length;
        for (let i = 0; i < childrenLength; i++) {
          yield* context.print(array[i]);
          if (i < childrenLength - 1) {
            yield separator;
          }
        }
      },
    };
    return {
      [Symbol.iterator]: function* () {
        yield* context.print(ast);
      },
    };
    function* indent(
      tokens: () => IterableIterator<string>,
    ): IterableIterator<string> {
      for (const token of tokens()) {
        yield token;
        if (token === EOL) {
          yield PADDING;
        }
      }
    }
  }
}
