import {
  classifyRootGraph,
  type ModelVisitNode,
  modelNodeAdapter,
} from '@ts-graphviz/common/internal/traversal';
import {
  type AttributeListModel,
  type DotObjectModel,
  type EdgeModel,
  type NodeModel,
  type RootGraphModel,
  type SubgraphModel,
} from '@ts-graphviz/common';
import { walk } from '@ts-graphviz/common/internal/traversal';
import type { CreateElement } from '../../builder/types.js';
import type {
  AttributeASTNode,
  CommentASTNode,
  CommentKind,
  EdgeTargetASTNode,
} from '../../types.js';
import { convertAttribute } from './shared/convert-attribute.js';
import { convertComment } from './shared/convert-comment.js';

/**
 * Build an AST from a model using the shared, iterative traversal skeleton.
 *
 * The traversal walks the canonical model child order exposed by
 * {@link modelNodeAdapter}; every visited model node maps to an AST node on
 * `leave`. This replaces the old per-plugin recursive dispatch while
 * preserving the exact child ordering and output shape.
 *
 * @internal
 */
function classifyEntry(model: DotObjectModel): ModelVisitNode {
  switch (model.$$type) {
    case 'Graph':
      return classifyRootGraph(model as RootGraphModel);
    case 'Subgraph':
      return {
        kind: 'Subgraph',
        node: model as SubgraphModel,
        owner: model,
      };
    case 'Node':
      return { kind: 'Node', node: model as NodeModel, owner: model };
    case 'Edge':
      return { kind: 'Edge', node: model as EdgeModel, owner: model };
    case 'AttributeList':
      return {
        kind: 'AttributeList',
        node: model as AttributeListModel,
        owner: model,
      };
    default:
      throw new Error(`Unsupported root model kind: ${String(model.$$type)}`);
  }
}

export function buildFromModel(
  model: DotObjectModel,
  createElement: CreateElement,
  commentKind: CommentKind,
): unknown {
  const entry = classifyEntry(model);
  const stack: Array<{ children: unknown[] }> = [];
  let result: unknown;

  walk(modelNodeAdapter, entry, {
    enter() {
      stack.push({ children: [] });
    },
    leave(visitNode) {
      const frame = stack.pop();
      if (!frame) return;
      const visit = visitNode as unknown as ModelVisitNode;
      const ast = buildNode(visit, frame.children, createElement, commentKind);
      // Only array-slot children (and the virtual attribute comment) belong
      // in the parent's ordered child list. Property children such as edge
      // targets are read out of band, but the leading attribute comment
      // produced via the `attributeComment` property slot must be included
      // inside Node/Edge brackets.
      const slot = visitNode.slot;
      const isEnclosedComment =
        visit.kind === 'LeadingComment' &&
        slot?.name === 'attributeComment';
      if (stack.length > 0) {
        if (slot?.container === 'array' || isEnclosedComment) {
          stack[stack.length - 1].children.push(ast);
        }
      } else {
        result = ast;
      }
    },
  });

  return result;
}

function literal(
  createElement: CreateElement,
  value: string,
  quoted: boolean | 'html',
) {
  return createElement('Literal', { value, quoted }, []);
}

function commentNode(
  createElement: CreateElement,
  value: string,
  kind: CommentKind,
): CommentASTNode {
  return convertComment(createElement, value, kind);
}

function buildNode(
  visit: ModelVisitNode,
  children: unknown[],
  createElement: CreateElement,
  commentKind: CommentKind,
): unknown {
  switch (visit.kind) {
    case 'LeadingComment': {
      const payload = visit.node as { value: string };
      return commentNode(createElement, payload.value, commentKind);
    }
    case 'AttributeAssignment': {
      const payload = visit.node as { key: string; value: unknown };
      return convertAttribute(
        createElement,
        payload.key as never,
        payload.value as never,
      );
    }
    case 'AttributeList':
      return createElement(
        'AttributeList',
        { kind: visit.node.$$kind },
        children as AttributeASTNode[],
      );
    case 'NodeRef':
      return createElement(
        'NodeRef',
        { id: literal(createElement, visit.node.id, true) } as never,
        [],
      );
    case 'ForwardRef':
      return createElement(
        'NodeRef',
        {
          id: literal(createElement, visit.node.id, true),
          port: visit.node.port
            ? literal(createElement, visit.node.port, true)
            : undefined,
          compass: visit.node.compass
            ? literal(createElement, visit.node.compass, true)
            : undefined,
        } as never,
        [],
      );
    case 'NodeRefGroup':
      return createElement('NodeRefGroup', {} as never, children as never);
    case 'Node': {
      const nodeChildren = attributeChildren(visit.node.comment, children, createElement, commentKind);
      return createElement(
        'Node',
        { id: literal(createElement, visit.node.id, true) },
        nodeChildren,
      );
    }
    case 'Edge':
      return buildEdge(visit.node, children, createElement);
    case 'Subgraph':
      return createElement(
        'Subgraph',
        {
          id: visit.node.id
            ? literal(createElement, visit.node.id, true)
            : undefined,
        },
        children as never[],
      );
    case 'RootGraph': {
      // The root graph's own comment (if any) precedes the graph keyword; all
      // other comments are leading siblings of body elements and stay in the
      // graph body.
      const all = children as Array<{ type: string }>;
      const rootComment = visit.node.comment ? [all[0]] : [];
      if (visit.node.comment && all[0]?.type !== 'Comment') {
        throw new Error('Internal error: missing root graph comment child.');
      }
      const body = all.slice(rootComment.length);
      return createElement(
        'Dot',
        {},
        [
          ...(rootComment as unknown[]),
          createElement(
            'Graph',
            {
              directed: visit.node.directed,
              strict: visit.node.strict,
              id: visit.node.id
                ? literal(createElement, visit.node.id, true)
                : undefined,
            },
            body as never[],
          ),
        ] as never[],
      );
    }
    default:
      return assertUnreachable(visit);
  }
}

function attributeChildren(
  comment: string | undefined,
  children: unknown[],
  createElement: CreateElement,
  commentKind: CommentKind,
): AttributeASTNode[] {
  // The cluster traversal already emits leading comments as separate siblings;
  // but the Node/Edge virtual `attributes` slot lists only assignments. The
  // node/edge `comment` is emitted by the *parent* cluster (as a leading
  // comment sibling), matching the pre-refactor behavior, so it is not added
  // here.
  void comment;
  void createElement;
  void commentKind;
  return children as AttributeASTNode[];
}

function buildEdge(
  edge: EdgeModel,
  children: unknown[],
  createElement: CreateElement,
): unknown {
  // Edge adapter slots are [targets, attributes]; walker appends in that
  // order, so children = [...targets(NodeRef/NodeRefGroup), ...attributes].
  const targetCount = edge.targets.length;
  const targets = children.slice(0, targetCount) as EdgeTargetASTNode[];
  const attributeChildren = children.slice(targetCount) as Array<
    AttributeASTNode | CommentASTNode
  >;
  return createElement(
    'Edge',
    {
      targets: targets as [
        EdgeTargetASTNode,
        EdgeTargetASTNode,
        ...EdgeTargetASTNode[],
      ],
    },
    attributeChildren,
  );
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled model visit kind: ${JSON.stringify(value)}`);
}

