import type { GraphBaseModel, ModelsContext } from '@ts-graphviz/common';
import { walk } from '@ts-graphviz/common/internal/traversal';
import { astNodeAdapter } from '../../traversal/ast-adapter.js';
import type { ASTVisitContext } from '../../traversal/traverse.js';
import type {
  AttributeASTNode,
  EdgeASTNode,
  NodeASTNode,
  SubgraphASTNode,
} from '../../types.js';
import type { ToModelConvertableASTNode } from './types.js';
import { collectAttributes } from './shared/collect-attributes.js';
import { CommentHolder } from './shared/comment-holder.js';
import { convertToEdgeTargetTuple } from './shared/convert-to-edge-target-tuple.js';

/**
 * Convert a convertable AST node to a model using the shared iterative
 * traversal skeleton.
 *
 * Only the structural cluster statements (Graph/Subgraph/Node/Edge/
 * AttributeList/direct-Attribute/Comment) need handling; edge targets and
 * literals are read directly from the AST (they carry no model state).
 *
 * @internal
 */
export function buildToModel(
  ast: ToModelConvertableASTNode,
  models: ModelsContext,
): unknown {
  interface ClusterFrame {
    graph: GraphBaseModel;
    comments: CommentHolder;
  }
  const clusterStack: ClusterFrame[] = [];
  const dotComments = new CommentHolder();
  let dotHasGraph = false;
  let rootModel: unknown;

  const attributeNodes = (children: readonly unknown[]): AttributeASTNode[] =>
    children.filter(
      (c): c is AttributeASTNode =>
        (c as { type?: string }).type === 'Attribute',
    );

  walk(astNodeAdapter, ast, {
    enter(visitArg: ASTVisitContext) {
      const visit = visitArg as ASTVisitContext;
      const parent = clusterStack[clusterStack.length - 1] ?? null;
      // Direct cluster statements (assignments / pending comments) live under
      // a Graph or Subgraph node. Attributes inside Node/Edge brackets share
      // the slot name `children` but must not be treated as cluster globals.
      const ownerKind = visit.path.length > 1
        ? visit.path[visit.path.length - 2]?.kind
        : undefined;
      const isClusterChild =
        ownerKind === 'Graph' || ownerKind === 'Subgraph';
      switch (visit.kind) {
        case 'Graph': {
          dotHasGraph = true;
          const G = visit.node.directed ? models.Digraph : models.Graph;
          const graph: GraphBaseModel = new G(
            visit.node.id?.value,
            visit.node.strict,
          );
          clusterStack.push({ graph, comments: new CommentHolder() });
          return;
        }
        case 'Subgraph': {
          let subgraph: GraphBaseModel;
          if (parent?.graph) {
            const owner = parent.graph;
            subgraph = visit.node.id
              ? owner.subgraph(visit.node.id.value)
              : owner.subgraph();
          } else {
            // Standalone Subgraph AST (parse start rule Subgraph).
            subgraph = new models.Subgraph(visit.node.id?.value);
            rootModel = subgraph;
          }
          clusterStack.push({
            graph: subgraph,
            comments: new CommentHolder(),
          });
          return;
        }
        case 'Comment':
          if (isClusterChild && parent) {
            parent.comments.set(visit.node);
          } else if (ownerKind === 'Dot') {
            dotComments.set(visit.node);
          }
          return;
        case 'Attribute':
          if (isClusterChild && parent) {
            parent.graph.set(
              visit.node.key.value as never,
              (visit.node.value.quoted === 'html'
                ? `<${visit.node.value.value}>`
                : visit.node.value.value) as never,
            );
            parent.comments.reset();
          }
          return;
        case 'AttributeList': {
          if (!parent) return;
          const attrs = collectAttributes(
            attributeNodes(visit.node.children),
          );
          switch (visit.node.kind) {
            case 'Edge':
              parent.graph.edge(attrs);
              break;
            case 'Node':
              parent.graph.node(attrs);
              break;
            case 'Graph':
              parent.graph.graph(attrs);
              break;
          }
          parent.comments.reset();
          return;
        }
        case 'Node': {
          if (!parent) return;
          const node = new models.Node(
            visit.node.id.value,
            collectAttributes(attributeNodes(visit.node.children)),
          );
          parent.graph.addNode(node);
          parent.comments.apply(node, visit.node.location);
          return;
        }
        case 'Edge': {
          if (!parent) return;
          const edge = new models.Edge(
            convertToEdgeTargetTuple(visit.node),
            collectAttributes(attributeNodes(visit.node.children)),
          );
          parent.graph.addEdge(edge);
          parent.comments.apply(edge, visit.node.location);
          return;
        }
        default:
          return;
      }
    },
    leave(visitArg: ASTVisitContext) {
      const visit = visitArg as ASTVisitContext;
      if (visit.kind === 'Subgraph') {
        const frame = clusterStack.pop();
        const parent = clusterStack[clusterStack.length - 1] ?? null;
        if (frame && parent) {
          parent.comments.apply(
            frame.graph as never,
            (visit.node as SubgraphASTNode).location,
          );
        }
        return;
      }
      if (visit.kind === 'Graph') {
        const frame = clusterStack.pop();
        if (frame) {
          // Apply Dot-level leading comments to the graph.
          dotComments.apply(frame.graph as never, visit.node.location);
          rootModel = frame.graph;
        }
      }
      if (visit.kind === 'Dot' && !dotHasGraph) {
        throw new Error('No graph found in Dot AST.');
      }
    },
  });

  // For non-cluster roots (Node/Edge standalone), build them directly.
  if (!rootModel) {
    if ((ast as { type?: string }).type === 'Node') {
      const nodeAst = ast as NodeASTNode;
      rootModel = new models.Node(
        nodeAst.id.value,
        collectAttributes(attributeNodes(nodeAst.children)),
      );
    } else if ((ast as { type?: string }).type === 'Edge') {
      const edgeAst = ast as EdgeASTNode;
      rootModel = new models.Edge(
        convertToEdgeTargetTuple(edgeAst),
        collectAttributes(attributeNodes(edgeAst.children)),
      );
    }
  }
  return rootModel;
}

