import type {
  Attribute,
  AttributeKey,
  EdgeTarget,
  ForwardRefNode,
  NodeModel,
  NodeRef,
} from '@ts-graphviz/common';
import {
  isNodeModel,
  ModelAttribute,
  ModelComment,
  ModelEdgeTarget,
  visitModel,
} from '@ts-graphviz/common';
import { createElementFactory } from '../../builder/create-element.js';
import type { CreateElement } from '../../builder/types.js';
import type {
  ASTNode,
  AttributeASTNode,
  CommentKind,
  EdgeTargetASTNode,
} from '../../types.js';
import type { ConvertFromModelOptions } from './types.js';

interface Frame {
  node: ASTNode;
  // The ordered array of AST children currently being assembled for nodes
  // that own a children collection.
  children?: ASTNode[];
}

/**
 * Build an AST from a model using the shared model traversal protocol.
 *
 * Slot ordering is owned by the model adapter, so the previous hand-written
 * `convertClusterChildren` sequence is no longer duplicated here.
 *
 * @group Convert Model to AST
 * @hidden
 */
export function convertModelToAST(
  modelRoot: import('@ts-graphviz/common').DotObjectModel,
  options: ConvertFromModelOptions = {},
): ASTNode {
  const { commentKind = 'Slash', maxASTNodes } = options;
  const createElement: CreateElement = createElementFactory({ maxASTNodes });

  const makeComment = (value: string) =>
    createElement('Comment', { kind: commentKind, value }, []);

  const makeAttribute = (
    key: AttributeKey,
    value: Attribute<AttributeKey>,
  ): AttributeASTNode => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^<.+>$/ms.test(trimmed)) {
        return createElement(
          'Attribute',
          {
            key: createElement('Literal', { value: key, quoted: false }, []),
            value: createElement(
              'Literal',
              { value: trimmed.slice(1, -1), quoted: 'html' },
              [],
            ),
          },
          [],
        );
      }
      return createElement(
        'Attribute',
        {
          key: createElement('Literal', { value: key, quoted: false }, []),
          value: createElement('Literal', { value, quoted: true }, []),
        },
        [],
      );
    }
    return createElement(
      'Attribute',
      {
        key: createElement('Literal', { value: key, quoted: false }, []),
        value: createElement(
          'Literal',
          { value: String(value), quoted: false },
          [],
        ),
      },
      [],
    );
  };

  const frames: Frame[] = [];
  let root: ASTNode | undefined;

  const append = (ast: ASTNode): void => {
    const parent = frames.at(-1);
    if (parent?.children) {
      parent.children.push(ast);
    }
  };

  visitModel(modelRoot as never, {
    enter(ctx) {
      const node = ctx.node;

      if (node instanceof ModelComment) {
        // Object/attribute comments are emitted at their real AST position by
        // the owning statement's enter handler, not from these visit-only
        // slots, to match statement-leading vs in-bracket placement.
        return;
      }
      if (node instanceof ModelAttribute) {
        append(makeAttribute(node.key, node.value));
        return;
      }
      if (node instanceof ModelEdgeTarget) {
        // Edge targets are handled when the owning edge is entered.
        return;
      }

      const kind = node.$$type;
      switch (kind) {
        case 'Graph': {
          const graph = node as import('@ts-graphviz/common').RootGraphModel;
          const children: ASTNode[] = [];
          const graphAST = createElement(
            'Graph',
            {
              directed: graph.directed,
              strict: graph.strict,
              id: graph.id
                ? createElement(
                    'Literal',
                    { value: graph.id, quoted: true },
                    [],
                  )
                : undefined,
            },
            children as never,
          );
          const dotChildren: ASTNode[] = [
            ...(graph.comment ? [makeComment(graph.comment)] : []),
            graphAST,
          ];
          const dot = createElement('Dot', {}, dotChildren as never);
          frames.push({ node: dot });
          frames.push({ node: graphAST, children });
          root = dot;
          return;
        }
        case 'Subgraph': {
          const subgraph = node as import('@ts-graphviz/common').SubgraphModel;
          const children: ASTNode[] = [];
          const ast = createElement(
            'Subgraph',
            {
              id: subgraph.id
                ? createElement(
                    'Literal',
                    { value: subgraph.id, quoted: true },
                    [],
                  )
                : undefined,
            },
            children as never,
          );
          if (subgraph.comment) {
            append(makeComment(subgraph.comment));
          }
          append(ast);
          frames.push({ node: ast, children });
          return;
        }
        case 'AttributeList': {
          const list = node as import('@ts-graphviz/common').AttributeListModel;
          const children: ASTNode[] = [
            ...(list.comment ? [makeComment(list.comment)] : []),
          ];
          const ast = createElement(
            'AttributeList',
            { kind: list.$$kind },
            children as never,
          );
          append(ast);
          frames.push({ node: ast, children });
          return;
        }
        case 'Node': {
          const modelNode = node as NodeModel;
          const children: ASTNode[] = [
            ...(modelNode.attributes.comment
              ? [makeComment(modelNode.attributes.comment)]
              : []),
          ];
          const ast = createElement(
            'Node',
            {
              id: createElement(
                'Literal',
                { value: modelNode.id, quoted: true },
                [],
              ),
            },
            children as never,
          );
          if (modelNode.comment) {
            append(makeComment(modelNode.comment));
          }
          append(ast);
          frames.push({ node: ast, children });
          return;
        }
        case 'Edge': {
          const edge = node as import('@ts-graphviz/common').EdgeModel;
          const children: ASTNode[] = [
            ...(edge.attributes.comment
              ? [makeComment(edge.attributes.comment)]
              : []),
          ];
          const targets = edge.targets.map((target) =>
            makeEdgeTargetAST(createElement, target),
          ) as [EdgeTargetASTNode, EdgeTargetASTNode, ...EdgeTargetASTNode[]];
          const ast = createElement('Edge', { targets }, children as never);
          if (edge.comment) {
            append(makeComment(edge.comment));
          }
          append(ast);
          frames.push({ node: ast, children });
          return;
        }
        default: {
          const exhaustive: never = kind;
          throw new Error(
            `Cannot convert model kind to AST: ${String(exhaustive)}`,
          );
        }
      }
    },
    leave(ctx) {
      const node = ctx.node;
      if (
        node instanceof ModelComment ||
        node instanceof ModelAttribute ||
        node instanceof ModelEdgeTarget
      ) {
        return;
      }
      frames.pop();
    },
  });

  if (!root) {
    throw new Error('Failed to build AST from model');
  }
  return root;
}

function makeEdgeTargetAST(
  createElement: CreateElement,
  target: EdgeTarget,
): EdgeTargetASTNode {
  if (Array.isArray(target)) {
    return createElement(
      'NodeRefGroup',
      {},
      target.map((entry) =>
        makeNodeRefAST(createElement, entry as NodeRef),
      ) as never,
    );
  }
  return makeNodeRefAST(createElement, target as NodeRef);
}

function makeNodeRefAST(
  createElement: CreateElement,
  ref: NodeRef,
): import('../../types.js').NodeRefASTNode {
  const literal = (value: string) =>
    createElement('Literal', { value, quoted: true }, []);
  if (isNodeModel(ref)) {
    return createElement(
      'NodeRef',
      {
        id: createElement(
          'Literal',
          { value: (ref as NodeModel).id, quoted: true },
          [],
        ),
      },
      [],
    );
  }
  const forward = ref as ForwardRefNode;
  return createElement(
    'NodeRef',
    {
      id: literal(forward.id),
      port: forward.port ? literal(forward.port) : undefined,
      compass: forward.compass
        ? (literal(forward.compass) as never)
        : undefined,
    },
    [],
  ) as unknown as import('../../types.js').NodeRefASTNode;
}

export type { CommentKind };
