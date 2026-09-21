import { createModelsContext } from '@ts-graphviz/common';
import { buildToModel } from './build-to-model.js';
import type {
  ASTToModel,
  ConvertToModelContext,
  ConvertToModelOptions,
  ConvertToModelPlugin,
  ToModelConvertableASTNode,
} from './types.js';

/**
 * Converts AST nodes to models.
 *
 * Standard AST shapes are converted through the shared iterative visitor
 * skeleton. A plugin registered with {@link ToModelConverter.use} takes
 * precedence (it is the custom-model / custom-AST escape hatch).
 *
 * @group Convert AST to Model
 */
export class ToModelConverter {
  /** @hidden */
  protected plugins: ConvertToModelPlugin<ToModelConvertableASTNode>[] = [];

  constructor(private options: ConvertToModelOptions = {}) {}

  /**
   * Register a custom conversion plugin. Custom plugins are consulted first.
   */
  public use(
    plugin: ConvertToModelPlugin<ToModelConvertableASTNode>,
  ): this {
    this.plugins.unshift(plugin);
    return this;
  }

  /**
   * Convert AST to Model.
   *
   * @param ast AST node.
   */
  public convert<T extends ToModelConvertableASTNode>(ast: T): ASTToModel<T> {
    const models = createModelsContext(this.options.models ?? {});
    for (const plugin of this.plugins) {
      if (plugin.match(ast)) {
        const context: ConvertToModelContext = {
          models,
          convert: <U extends ToModelConvertableASTNode>(m: U): ASTToModel<U> =>
            this.convert(m),
        };
        return plugin.convert(context, ast) as ASTToModel<T>;
      }
    }
    return buildToModel(ast, models) as ASTToModel<T>;
  }
}
