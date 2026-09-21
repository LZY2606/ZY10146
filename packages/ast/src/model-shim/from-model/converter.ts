import type { DotObjectModel } from '@ts-graphviz/common';
import { createElementFactory } from '../../builder/create-element.js';
import { buildFromModel } from './build-from-model.js';
import type {
  ConvertFromModelContext,
  ConvertFromModelOptions,
  ConvertFromModelPlugin,
  ModelToAST,
} from './types.js';

const STANDARD_MODEL_TYPES = new Set([
  'Graph',
  'AttributeList',
  'Node',
  'Edge',
  'Subgraph',
]);

/**
 * FromModelConverter converts a {@link DotObjectModel} into an AST node.
 *
 * The standard model kinds are converted through the shared, iterative
 * visitor skeleton (`@ts-graphviz/common/internal/traversal`). A custom
 * plugin registered with {@link FromModelConverter.use} takes over when it
 * matches a model (e.g. a user-defined `$$type`).
 *
 * @group Convert Model to AST
 */
export class FromModelConverter {
  /** @hidden */
  #plugins: ConvertFromModelPlugin<DotObjectModel>[] = [];

  constructor(private options: ConvertFromModelOptions = {}) {}

  /**
   * Register a custom conversion plugin. Custom plugins are consulted before
   * the standard shared traversal.
   */
  public use(plugin: ConvertFromModelPlugin<DotObjectModel>): this {
    this.#plugins.unshift(plugin);
    return this;
  }

  /**
   * Converts a DotObjectModel into an AST.
   *
   * @param model The {@link DotObjectModel} to be converted.
   * @returns The AST generated from the model.
   */
  public convert<T extends DotObjectModel>(model: T): ModelToAST<T> {
    const plugins = [...this.#plugins];
    const { commentKind = 'Slash', maxASTNodes } = this.options;
    const createElement = createElementFactory({ maxASTNodes });

    for (const plugin of plugins) {
      if (plugin.match(model)) {
        const context: ConvertFromModelContext = {
          commentKind,
          createElement,
          convert<U extends DotObjectModel>(m: U): ModelToAST<U> {
            for (const p of plugins) {
              if (p.match(m)) return p.convert(context, m) as ModelToAST<U>;
            }
            throw Error(`No from-model plugin for ${String(m.$$type)}`);
          },
        };
        return plugin.convert(context, model) as ModelToAST<T>;
      }
    }

    if (!STANDARD_MODEL_TYPES.has(model.$$type)) {
      // Non-standard models without a custom plugin cannot be traversed.
      throw Error(`No from-model plugin for ${String(model.$$type)}`);
    }

    return buildFromModel(
      model,
      createElement,
      commentKind,
    ) as ModelToAST<T>;
  }
}
