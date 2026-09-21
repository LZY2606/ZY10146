import type { DotObjectModel } from '@ts-graphviz/common';
import { convertModelToAST } from './model-walk-converter.js';
import type { ConvertFromModelOptions, ModelToAST } from './types.js';

/**
 * A function used to convert a DotObjectModel into an AST using the shared
 * model traversal protocol.
 *
 * @param model - The {@link DotObjectModel} to be converted.
 * @param options - An optional {@link ConvertFromModelOptions} object.
 * @returns ModelToAST - The AST representation of the {@link DotObjectModel}.
 *
 * @group Convert Model to AST
 */
export function fromModel<T extends DotObjectModel>(
  model: T,
  options?: ConvertFromModelOptions,
): ModelToAST<T> {
  return convertModelToAST(model, options) as ModelToAST<T>;
}
