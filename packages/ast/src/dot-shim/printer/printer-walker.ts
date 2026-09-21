import { astSlots } from '../../traversal/ast-adapter.js';
import type {
  ASTNode,
  AttributeListASTNode,
  CommentASTNode,
  CommentKind,
  EdgeASTNode,
  GraphASTNode,
  LiteralASTNode,
  NodeASTNode,
  NodeRefASTNode,
  NodeRefGroupASTNode,
  SubgraphASTNode,
} from '../../types.js';
import type { PrintOptions } from './types.js';
import { escape } from './utils/escape.js';
import { escapeComment } from './utils/escape-comment.js';

const EOL_PATTERN = /\r?\n/;
const COMMENT_PADDING: Record<CommentKind, string> = {
  Block: ' * ',
  Macro: '# ',
  Slash: '// ',
};

/**
 * Stack-safe DOT printer whose child discovery uses the AST adapter slots.
 *
 * Every node is rendered by an exhaustive `renderNode`; where the original
 * printer recursed (`print`, `join`, `printChildren`), this version walks
 * adapter slots via an explicit work stack. Indentation and separators are
 * carried by frames, yielding byte-identical output to the plugin printer.
 *
 * @group Convert AST to DOT
 * @hidden
 */
export function printWithWalker(ast: ASTNode, options: PrintOptions): string {
  const { indentSize = 2, indentStyle = 'space', endOfLine = 'lf' } = options;
  const EOL = endOfLine === 'crlf' ? '\r\n' : '\n';
  const PADDING = indentStyle === 'space' ? ' '.repeat(indentSize) : '\t';

  let directed = true;
  const out: string[] = [];
  const write = (token: string): void => {
    out.push(token);
  };
  const newline = (depth: number): void => {
    write(EOL);
    write(PADDING.repeat(depth));
  };

  const comment = (node: CommentASTNode, depth: number): void => {
    if (node.kind === 'Block') {
      write('/**');
      newline(depth);
    }
    const lines = escapeComment(node.value, node.kind).split(EOL_PATTERN);
    lines.forEach((line, index) => {
      write(COMMENT_PADDING[node.kind]);
      write(line);
      if (index < lines.length - 1) {
        newline(depth);
      }
    });
    if (node.kind === 'Block') {
      newline(depth);
      write(' */');
    }
  };

  const literal = (node: LiteralASTNode): void => {
    if (node.quoted === 'html') {
      write('<');
      write(node.value);
      write('>');
      return;
    }
    if (node.quoted === true) {
      write('"');
      write(escape(node.value));
      write('"');
      return;
    }
    write(node.value);
  };

  const nodeRef = (node: NodeRefASTNode): void => {
    literal(node.id);
    if (node.port) {
      write(':');
      literal(node.port);
    }
    if (node.compass) {
      write(':');
      literal(node.compass);
    }
  };

  const nodeRefGroup = (node: NodeRefGroupASTNode): void => {
    write('{');
    node.children.forEach((ref, index) => {
      if (index > 0) {
        write(' ');
      }
      nodeRef(ref);
    });
    write('}');
  };

  /**
   * Render an ordered array of statements (the contents of a cluster block
   * or an attribute bracket), one item per indented line.
   */
  interface Frame {
    kind: 'Dot' | 'Graph' | 'Subgraph' | 'Node' | 'Edge' | 'AttributeList';
    // Depth at which the opening/closing token is rendered.
    headDepth: number;
    // Depth at which child statement lines are rendered.
    childDepth: number;
    items: ASTNode[];
    cursor: number;
    node: ASTNode;
    block: boolean;
  }

  const blockItems = (node: ASTNode): ASTNode[] => {
    // Use the adapter's ordered, named slots so child ordering is defined in
    // exactly one place. For statement containers this yields the `children`
    // array (and named scalars are not part of bracket/block statement lists).
    const slots = astSlots(node);
    const result: ASTNode[] = [];
    for (const slot of slots) {
      if (slot.key === 'children') {
        result.push(...(slot.nodes as ASTNode[]));
      }
    }
    return result;
  };

  function isFrameContainer(frame: { kind: string; block: boolean }): boolean {
    if (
      frame.kind === 'Dot' ||
      frame.kind === 'Graph' ||
      frame.kind === 'Subgraph'
    ) {
      return true;
    }
    // Node/Edge/AttributeList frames only exist as containers when they open a
    // bracket with children.
    return frame.block;
  }

  const renderHead = (node: ASTNode, headDepth: number): Frame | undefined => {
    switch (node.type) {
      case 'Dot':
        return {
          kind: 'Dot',
          headDepth: 0,
          childDepth: 0,
          items: blockItems(node),
          cursor: 0,
          node,
          block: true,
        };
      case 'Graph': {
        const graph = node as GraphASTNode;
        directed = graph.directed;
        if (graph.strict) {
          write('strict ');
        }
        write(directed ? 'digraph' : 'graph');
        if (graph.id) {
          write(' ');
          literal(graph.id);
        }
        write(' {');
        return {
          kind: 'Graph',
          headDepth,
          childDepth: headDepth + 1,
          items: blockItems(graph),
          cursor: 0,
          node: graph,
          block: true,
        };
      }
      case 'Subgraph': {
        const sub = node as SubgraphASTNode;
        write('subgraph');
        if (sub.id) {
          write(' ');
          literal(sub.id);
        }
        write(' {');
        return {
          kind: 'Subgraph',
          headDepth,
          childDepth: headDepth + 1,
          items: blockItems(sub),
          cursor: 0,
          node: sub,
          block: true,
        };
      }
      case 'Node': {
        const n = node as NodeASTNode;
        literal(n.id);
        if (n.children.length >= 1) {
          write(' [');
          return {
            kind: 'Node',
            headDepth,
            childDepth: headDepth + 1,
            items: blockItems(n),
            cursor: 0,
            node: n,
            block: true,
          };
        }
        write(';');
        return undefined;
      }
      case 'Edge': {
        const e = node as EdgeASTNode;
        e.targets.forEach((target, index) => {
          if (index > 0) {
            write(directed ? ' -> ' : ' -- ');
          }
          if (target.type === 'NodeRef') {
            nodeRef(target);
          } else {
            nodeRefGroup(target);
          }
        });
        if (e.children.length === 0) {
          write(';');
          return undefined;
        }
        write(' [');
        return {
          kind: 'Edge',
          headDepth,
          childDepth: headDepth + 1,
          items: blockItems(e),
          cursor: 0,
          node: e,
          block: true,
        };
      }
      case 'AttributeList': {
        const list = node as AttributeListASTNode;
        if (list.children.length === 0) {
          write(`${list.kind.toLocaleLowerCase()} [];`);
          return undefined;
        }
        write(`${list.kind.toLocaleLowerCase()} [`);
        return {
          kind: 'AttributeList',
          headDepth,
          childDepth: headDepth + 1,
          items: blockItems(list),
          cursor: 0,
          node: list,
          block: true,
        };
      }
      case 'Attribute':
        literal(node.key);
        write(' = ');
        literal(node.value);
        write(';');
        return undefined;
      case 'Comment':
        comment(node, headDepth);
        return undefined;
      case 'Literal':
        literal(node);
        return undefined;
      case 'NodeRef':
        nodeRef(node);
        return undefined;
      case 'NodeRefGroup':
        nodeRefGroup(node);
        return undefined;
      default: {
        const exhaustive: never = node;
        throw new Error(
          `No printer for AST node: ${String(exhaustive as unknown)}`,
        );
      }
    }
  };

  // Explicit stack; each container frame owns the indentation depth of its
  // children (frame.depth is the container's own depth).
  const frames: Frame[] = [];
  const rootFrame = renderHead(ast, 0);
  if (rootFrame) {
    frames.push(rootFrame);
  }

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.cursor >= frame.items.length) {
      const isCluster = frame.kind === 'Graph' || frame.kind === 'Subgraph';
      if (frame.kind === 'Dot') {
        frames.pop();
        continue;
      }
      if (frame.items.length >= 1) {
        newline(frame.headDepth);
      }
      if (isCluster) {
        write('}');
      } else if (frame.block) {
        write('];');
      }
      frames.pop();
      continue;
    }

    const item = frame.items[frame.cursor];
    frame.cursor += 1;
    if (frame.kind === 'Dot') {
      // Root statements are joined by EOL at column 0; the first statement
      // is emitted without a leading newline.
      if (frame.cursor > 1) {
        newline(0);
      }
      const childFrame = renderHead(item, 0);
      if (childFrame && isFrameContainer(childFrame)) {
        frames.push(childFrame);
      }
      continue;
    }
    // Nested blocks indent every child line at childDepth.
    newline(frame.childDepth);
    const childFrame = renderHead(item, frame.childDepth);
    if (childFrame && isFrameContainer(childFrame)) {
      frames.push(childFrame);
    }
  }

  return out.join('');
}

