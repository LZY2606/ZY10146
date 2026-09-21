import type { ASTNode, EdgeASTNode, NodeASTNode } from '../types.js';
import { visitAST } from './visit-ast.js';

/**
 * Aggregate counts produced by {@link analyzeAST}.
 *
 * @group AST Traversal
 */
export interface ASTAnalysis {
  graphs: number;
  subgraphs: number;
  anonymousSubgraphs: number;
  nodes: number;
  edges: number;
  attributeLists: number;
  attributes: number;
  comments: number;
  literals: number;
  nodeRefs: number;
  nodeRefGroups: number;
  /**
   * Maximum nesting depth of graph/subgraph blocks, starting at 1 for the
   * root graph.
   */
  maxDepth: number;
}

/**
 * Analyze an AST with the shared read-only traversal skeleton.
 *
 * This is an example of a structural analysis tool that needs no bespoke
 * recursion: classification and child ordering come exclusively from the AST
 * adapter.
 *
 * @group AST Traversal
 */
export function analyzeAST(root: ASTNode): ASTAnalysis {
  const result: ASTAnalysis = {
    graphs: 0,
    subgraphs: 0,
    anonymousSubgraphs: 0,
    nodes: 0,
    edges: 0,
    attributeLists: 0,
    attributes: 0,
    comments: 0,
    literals: 0,
    nodeRefs: 0,
    nodeRefGroups: 0,
    maxDepth: 0,
  };

  visitAST(root, {
    enter(ctx) {
      switch (ctx.kind) {
        case 'Graph':
          result.graphs += 1;
          break;
        case 'Subgraph':
          result.subgraphs += 1;
          break;
        case 'AnonymousCluster':
          result.anonymousSubgraphs += 1;
          result.subgraphs += 1;
          break;
        case 'Node':
          result.nodes += 1;
          break;
        case 'Edge':
          result.edges += 1;
          break;
        case 'AttributeList':
          result.attributeLists += 1;
          break;
        case 'Attribute':
          result.attributes += 1;
          break;
        case 'Comment':
          result.comments += 1;
          break;
        case 'Literal':
          result.literals += 1;
          break;
        case 'NodeRef':
          result.nodeRefs += 1;
          break;
        case 'NodeRefGroup':
          result.nodeRefGroups += 1;
          break;
        case 'Document':
        case 'EdgeTarget':
          break;
      }
      if (
        ctx.kind === 'Graph' ||
        ctx.kind === 'Subgraph' ||
        ctx.kind === 'AnonymousCluster'
      ) {
        const depth = ctx.path.filter(
          (entry) =>
            entry.kind === 'Graph' ||
            entry.kind === 'Subgraph' ||
            entry.kind === 'AnonymousCluster',
        ).length;
        if (depth > result.maxDepth) {
          result.maxDepth = depth;
        }
      }
    },
  });

  return result;
}

/**
 * Collect every node statement reachable from an AST in document order.
 *
 * @group AST Traversal
 */
export function collectNodeStatements(root: ASTNode): NodeASTNode[] {
  const nodes: NodeASTNode[] = [];
  visitAST(root, {
    enter(ctx) {
      if (ctx.node.type === 'Node') {
        nodes.push(ctx.node);
      }
    },
  });
  return nodes;
}

/**
 * Collect every edge statement reachable from an AST in document order.
 *
 * @group AST Traversal
 */
export function collectEdgeStatements(root: ASTNode): EdgeASTNode[] {
  const edges: EdgeASTNode[] = [];
  visitAST(root, {
    enter(ctx) {
      if (ctx.node.type === 'Edge') {
        edges.push(ctx.node);
      }
    },
  });
  return edges;
}
