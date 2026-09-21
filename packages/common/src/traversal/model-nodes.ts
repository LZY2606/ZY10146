import type { Attribute, AttributeKey, EdgeTarget } from '@ts-graphviz/common';

/**
 * A single key/value assignment held by an attribute-bearing model.
 *
 * Unlike the AST, the OO model stores attributes in ordered maps rather than
 * as statement children. The model adapter materializes one of these views
 * per entry so assignments remain a first-class, distinct traversal kind.
 *
 * @group Model Traversal
 */
export class ModelAttribute<K extends AttributeKey = AttributeKey> {
  /** @hidden */
  static readonly $$traversalKind = 'Attribute' as const;

  constructor(
    public readonly key: K,
    public value: Attribute<K>,
    /**
     * Attribute container owning this entry. Mutations are applied through the
     * container so the ordered map is preserved.
     * @hidden
     */
    public readonly owner: AttributeContainer,
  ) {}
}

/**
 * Minimal structural interface of an attribute container the adapter can
 * read and edit through the model's ordered map API.
 *
 * @group Model Traversal
 */
export interface AttributeContainer {
  readonly size: number;
  readonly values: ReadonlyArray<[AttributeKey, Attribute<AttributeKey>]>;
  get(key: AttributeKey): Attribute<AttributeKey> | undefined;
  set(key: AttributeKey, value: Attribute<AttributeKey>): void;
  delete(key: AttributeKey): void;
}

/**
 * A comment attached to a model object.
 *
 * Models keep comments as optional string properties rather than as ordered
 * child statements, so the adapter materializes them as a distinct, read-mostly
 * node kind instead of pretending they are AST comments.
 *
 * @group Model Traversal
 */
export class ModelComment {
  /** @hidden */
  static readonly $$traversalKind = 'Comment' as const;

  constructor(
    public value: string,
    /** Object whose `comment` field backs this node. @hidden */
    public readonly owner: { comment?: string },
  ) {}
}

/**
 * A node reference endpoint of an edge.
 *
 * Edge targets in the model are plain tuples of `NodeModel`, `ForwardRefNode`
 * or arrays of them. They are read-only endpoints; structural edits are not
 * part of the model API.
 *
 * @group Model Traversal
 */
export class ModelEdgeTarget {
  /** @hidden */
  static readonly $$traversalKind = 'EdgeTarget' as const;

  constructor(
    public readonly target: EdgeTarget,
    /** @hidden */ public readonly index: number,
  ) {}
}

/**
 * Every node that can appear during a model traversal.
 *
 * The union is intentionally a discriminated set that mirrors the real model
 * shape: graph models, attribute entries, attached comments and edge
 * endpoints are distinct kinds rather than a bag of optional fields.
 *
 * @group Model Traversal
 */
export type ModelTraversalNode =
  | import('@ts-graphviz/common').RootGraphModel
  | import('@ts-graphviz/common').SubgraphModel
  | import('@ts-graphviz/common').NodeModel
  | import('@ts-graphviz/common').EdgeModel
  | import('@ts-graphviz/common').AttributeListModel
  | ModelAttribute
  | ModelComment
  | ModelEdgeTarget;
