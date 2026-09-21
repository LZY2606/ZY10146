import { convertASTToModel } from './ast-walk-converter.js';
import type {
  ASTToModel,
  ConvertToModelOptions,
  ToModelConvertableASTNode,
} from './types.js';

/**
 * Backward compatible converter entry point; conversion is driven by the
 * shared traversal protocol.
 *
 * @group Convert AST to Model
 */
export class ToModelConverter {
  constructor(private options: ConvertToModelOptions = {}) {}

  /**
   * Convert AST to Model.
   */
  public convert<T extends ToModelConvertableASTNode>(ast: T): ASTToModel<T> {
    return convertASTToModel(ast, this.options) as ASTToModel<T>;
  }
}
