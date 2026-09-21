import { walk } from '../walker.js';
import {
  classifyRootGraph,
  modelNodeAdapter,
} from './model-adapter.js';
import type { RootGraphModel } from '../../models.js';

/**
 * Basic structural statistics collected from an object model.
 *
 * This is an example of an analysis tool built directly on the shared
 * traversal skeleton: it does not depend on the AST package and does not
 * mutate the model.
 *
 * @internal
 */
export interface ModelStats {
  graphs: number;
  subgraphs: number;
  nodes: number;
  edges: number;
  attributeAssignments: number;
  attributeLists: number;
  comments: number;
  /** Maximum nesting depth of clusters (the root graph is depth 0). */
  maxDepth: number;
}

/**
 * Walk an object model and collect structural statistics.
 *
 * @internal
 */
export function analyzeModel(root: RootGraphModel): ModelStats {
  const stats: ModelStats = {
    graphs: 0,
    subgraphs: 0,
    nodes: 0,
    edges: 0,
    attributeAssignments: 0,
    attributeLists: 0,
    comments: 0,
    maxDepth: 0,
  };
  walk(modelNodeAdapter, classifyRootGraph(root), {
    enter(visit) {
      switch (visit.kind) {
        case 'RootGraph':
          stats.graphs++;
          stats.maxDepth = Math.max(stats.maxDepth, visit.depth);
          return;
        case 'Subgraph':
          stats.subgraphs++;
          stats.maxDepth = Math.max(stats.maxDepth, visit.depth);
          return;
        case 'Node':
          stats.nodes++;
          return;
        case 'Edge':
          stats.edges++;
          return;
        case 'AttributeAssignment':
          stats.attributeAssignments++;
          return;
        case 'AttributeList':
          stats.attributeLists++;
          return;
        case 'LeadingComment':
          stats.comments++;
          return;
        default:
          return;
      }
    },
  });
  return stats;
}
