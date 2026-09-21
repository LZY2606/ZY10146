import type {
  ASTNode,
  AttributeASTNode,
  AttributeListASTNode,
  CommentASTNode,
  DotASTNode,
  EdgeASTNode,
  GraphASTNode,
  LiteralASTNode,
  NodeASTNode,
  NodeRefASTNode,
  NodeRefGroupASTNode,
  SubgraphASTNode,
} from '../types.js';

/**
 * Discriminated, type-complete classification of every AST node kind used by
 * the internal visitor protocol.
 *
 * {@link AttributeASTNode}, {@link CommentASTNode}, edge targets
 * ({@link NodeRefASTNode}/{@link NodeRefGroupASTNode}) and anonymous
 * {@link SubgraphASTNode} stay distinct kinds on purpose: the protocol must
 * not flatten them into one shape with a pile of optional fields.
 *
 * @internal
 */
export type ASTClassifiedNode =
  | { kind: 'Literal'; node: LiteralASTNode }
  | { kind: 'Dot'; node: DotASTNode }
  | { kind: 'Graph'; node: GraphASTNode }
  | { kind: 'Attribute'; node: AttributeASTNode }
  | { kind: 'Comment'; node: CommentASTNode }
  | { kind: 'AttributeList'; node: AttributeListASTNode }
  | { kind: 'NodeRef'; node: NodeRefASTNode }
  | { kind: 'NodeRefGroup'; node: NodeRefGroupASTNode }
  | { kind: 'Edge'; node: EdgeASTNode }
  | { kind: 'Node'; node: NodeASTNode }
  | { kind: 'Subgraph'; node: SubgraphASTNode };

/** Every discriminated AST node kind. Add a kind here to force adapter updates. */
export type ASTNodeKind = ASTClassifiedNode['kind'];

/**
 * Narrow an arbitrary {@link ASTNode} into its classified form. The switch is
 * exhaustive: adding a new `type` makes the {@link assertNever} fallback fail
 * to compile.
 *
 * @internal
 */
export function classifyASTNode(node: ASTNode): ASTClassifiedNode {
  switch (node.type) {
    case 'Literal':
      return { kind: 'Literal', node };
    case 'Dot':
      return { kind: 'Dot', node };
    case 'Graph':
      return { kind: 'Graph', node };
    case 'Attribute':
      return { kind: 'Attribute', node };
    case 'Comment':
      return { kind: 'Comment', node };
    case 'AttributeList':
      return { kind: 'AttributeList', node };
    case 'NodeRef':
      return { kind: 'NodeRef', node };
    case 'NodeRefGroup':
      return { kind: 'NodeRefGroup', node };
    case 'Edge':
      return { kind: 'Edge', node };
    case 'Node':
      return { kind: 'Node', node };
    case 'Subgraph':
      return { kind: 'Subgraph', node };
    default: {
      // Compile-time exhaustiveness: a new AST type is not handled above.
      const exhaustive: never = node;
      return exhaustive as never;
    }
  }
}
