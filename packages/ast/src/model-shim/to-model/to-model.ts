import { convertASTToModel } from './ast-walk-converter.js';
import type {
  ASTToModel,
  ConvertToModelOptions,
  ToModelConvertableASTNode,
} from './types.js';

/**
 * Convert an AST node to a model using the shared traversal protocol.
 *
 * @group Convert AST to Model
 */
export function toModel<T extends ToModelConvertableASTNode>(
  ast: T,
  options?: ConvertToModelOptions,
): ASTToModel<T> {
  return convertASTToModel(ast, options) as ASTToModel<T>;
}
