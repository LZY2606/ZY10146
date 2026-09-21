import type { DotObjectModel } from '@ts-graphviz/common';
import { convertModelToAST } from './model-walk-converter.js';
import type { ConvertFromModelOptions, ModelToAST } from './types.js';

/**
 * Backward compatible converter entry point; conversion is driven by the
 * shared model traversal protocol.
 *
 * @group Convert Model to AST
 */
export class FromModelConverter {
  constructor(private options: ConvertFromModelOptions = {}) {}

  /**
   * Converts a DotObjectModel into an AST.
   */
  public convert<T extends DotObjectModel>(model: T): ModelToAST<T> {
    return convertModelToAST(model, this.options) as ModelToAST<T>;
  }
}
