import type { ModelTraversalNode } from '../src/traversal/model-nodes.js';
import { modelKind } from '../src/traversal/model-adapter.js';
import type { TraversalKind } from '../src/traversal/index.js';

declare const node: ModelTraversalNode;
export const kind: TraversalKind = modelKind(node);
