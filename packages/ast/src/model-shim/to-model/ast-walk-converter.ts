import {
  createModelsContext,
  type EdgeTarget,
  type EdgeTargetTuple,
  type GraphBaseModel,
  type ModelsContext,
  SKIP,
} from '@ts-graphviz/common';
import { visitAST } from '../../traversal/visit-ast.js';
import type {
  AttributeASTNode,
  CommentASTNode,
  DotASTNode,
  EdgeASTNode,
  FileRange,
  GraphASTNode,
  NodeASTNode,
  SubgraphASTNode,
} from '../../types.js';
import type { ConvertToModelOptions } from './types.js';

type ConvertableRoot =
  | DotASTNode
  | GraphASTNode
  | SubgraphASTNode
  | NodeASTNode
  | EdgeASTNode;

interface Frame {
  graph?: GraphBaseModel;
  pendingComment: CommentASTNode | null;
  isList?: boolean;
  listKind?: 'Graph' | 'Edge' | 'Node';
  listAttributes?: Record<string, unknown>;
}

const htmlValue = (value: { quoted: boolean | 'html'; value: string }) =>
  value.quoted === 'html' ? `<${value.value}>` : value.value;

function gatherAttributes(
  node: NodeASTNode | EdgeASTNode,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const child of (node as { children: AttributeASTNode[] }).children) {
    if (child.type === 'Attribute') {
      out[child.key.value] = htmlValue(child.value);
    }
  }
  return out;
}

function toEdgeTuple(edge: EdgeASTNode): EdgeTargetTuple {
  return edge.targets.map((target): EdgeTarget => {
    if (target.type === 'NodeRefGroup') {
      return target.children.map((ref) => ({
        id: ref.id.value,
        port: ref.port?.value,
        compass: ref.compass?.value,
      }));
    }
    return {
      id: target.id.value,
      port: target.port?.value,
      compass: target.compass?.value,
    };
  }) as EdgeTargetTuple;
}

function claimComment(
  comment: CommentASTNode | null,
  model: { comment?: string },
  location: FileRange | undefined,
): CommentASTNode | null {
  if (!comment) {
    return null;
  }
  if (location && comment.location) {
    if (comment.kind === 'Block') {
      if (comment.location.end.line === location.start.line - 1) {
        model.comment = comment.value;
      }
    } else if (comment.location.end.line === location.start.line) {
      model.comment = comment.value;
    }
    return null;
  }
  model.comment = comment.value;
  return null;
}

/**
 * Build a model from an AST using the shared read-only traversal.
 *
 * Graph statements are handled in one exhaustive switch; comment association
 * and default attribute lists are carried by explicit frames rather than
 * duplicated recursive helpers.
 *
 * @group Convert AST to Model
 * @hidden
 */
export function convertASTToModel(
  root: ConvertableRoot,
  options: ConvertToModelOptions = {},
): unknown {
  const models: ModelsContext = createModelsContext(options.models ?? {});
  const frames: Frame[] = [];
  let result: unknown;

  const top = (): Frame => frames[frames.length - 1];
  const ensureFrame = (): Frame => {
    if (frames.length === 0) {
      frames.push({ pendingComment: null });
    }
    return top();
  };

  visitAST(root, {
    enter(ctx) {
      const node = ctx.node;

      if (node.type === 'Comment') {
        const comment = node as CommentASTNode;
        if (frames.length === 0) {
          frames.push({ pendingComment: comment });
        } else {
          top().pendingComment = comment;
        }
        return SKIP;
      }

      switch (node.type) {
        case 'Dot':
          frames.push({ pendingComment: null });
          return;
        case 'Graph': {
          const graphNode = node as GraphASTNode;
          const Ctor = graphNode.directed ? models.Digraph : models.Graph;
          const graph = new Ctor(graphNode.id?.value, graphNode.strict);
          graph.with(options.models ?? {});
          const preceding = frames.at(-1)?.pendingComment ?? null;
          frames.push({ graph, pendingComment: null });
          claimComment(preceding, graph, graphNode.location);
          result = graph;
          return;
        }
        case 'Subgraph': {
          const subNode = node as SubgraphASTNode;
          let ownerFrame = top();
          if (!ownerFrame?.graph) {
            // A bare Subgraph root: give it a throwaway host so the same
            // statement machinery applies, then expose the subgraph itself.
            const host = new models.Digraph();
            host.with(options.models ?? {});
            ownerFrame = { graph: host, pendingComment: null };
            frames.push(ownerFrame);
          }
          const parent = ownerFrame.graph!;
          const subgraph = subNode.id
            ? parent.subgraph(subNode.id.value)
            : parent.subgraph();
          const preceding = ownerFrame.pendingComment;
          frames.push({ graph: subgraph, pendingComment: null });
          claimComment(preceding, subgraph, subNode.location);
          if (ctx.parent === undefined) {
            result = subgraph;
          }
          return;
        }
        case 'Attribute': {
          const attr = node as AttributeASTNode;
          if (ctx.slot === 'children') {
            top().graph?.set(
              attr.key.value as never,
              htmlValue(attr.value) as never,
            );
            top().pendingComment = null;
          }
          return SKIP;
        }
        case 'AttributeList':
          frames.push({
            graph: top().graph,
            pendingComment: top().pendingComment,
            isList: true,
            listKind: node.kind,
            listAttributes: {},
          });
          return;
        case 'Node': {
          const frame = ensureFrame();
          const nodeNode = node as NodeASTNode;
          const modelNode = new models.Node(
            nodeNode.id.value,
            gatherAttributes(nodeNode) as never,
          );
          frame.pendingComment = claimComment(
            frame.pendingComment,
            modelNode,
            nodeNode.location,
          );
          frame.graph?.addNode(modelNode);
          if (!frame.graph) {
            result = modelNode;
          }
          return SKIP;
        }
        case 'Edge': {
          const frame = ensureFrame();
          const edgeNode = node as EdgeASTNode;
          const modelEdge = new models.Edge(
            toEdgeTuple(edgeNode),
            gatherAttributes(edgeNode) as never,
          );
          frame.pendingComment = claimComment(
            frame.pendingComment,
            modelEdge,
            edgeNode.location,
          );
          frame.graph?.addEdge(modelEdge);
          if (!frame.graph) {
            result = modelEdge;
          }
          return SKIP;
        }
        default:
          return SKIP;
      }
    },
    leave(ctx) {
      const node = ctx.node;
      if (node.type === 'Dot') {
        frames.pop();
        return;
      }
      if (node.type === 'Graph') {
        frames.pop();
        return;
      }
      if (node.type === 'Subgraph') {
        frames.pop();
        return;
      }
      if (node.type === 'AttributeList') {
        const frame = frames.pop()!;
        const attributes = frame.listAttributes ?? {};
        for (const child of node.children) {
          if (child.type === 'Attribute') {
            attributes[child.key.value] = htmlValue(child.value);
          }
        }
        const graph = frame.graph!;
        if (frame.listKind === 'Edge') {
          graph.edge(attributes as never);
        } else if (frame.listKind === 'Node') {
          graph.node(attributes as never);
        } else {
          graph.graph(attributes as never);
        }
        top().pendingComment = null;
      }
    },
  });

  if (result === undefined) {
    throw new Error('No convertible node found in AST');
  }
  return result;
}
