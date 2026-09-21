import { walk } from '@ts-graphviz/common/internal/traversal';
import { astNodeAdapter } from '../../traversal/ast-adapter.js';
import type { ASTVisitContext } from '../../traversal/traverse.js';
import type { ASTNode, CommentKind } from '../../types.js';
import { escapeComment } from './plugins/utils/escape-comment.js';
import { escape } from './plugins/utils/escape.js';
import type { PrintOptions } from './types.js';

/**
 * Walker-driven DOT emitter.
 *
 * Replaces the old generator-based per-node plugin recursion with the shared
 * iterative traversal skeleton. Every AST kind renders itself: array/property
 * children carry explicit separators, and indentation follows the open
 * container depth.
 *
 * @internal
 */
export function printAST(root: ASTNode, options: PrintOptions = {}): string {
  const {
    indentSize = 2,
    indentStyle = 'space',
    endOfLine = 'lf',
  } = options;
  const EOL = endOfLine === 'crlf' ? '\r\n' : '\n';
  const PAD = indentStyle === 'space' ? ' '.repeat(indentSize) : '\t';

  const chunks: string[] = [];
  const push = (...parts: string[]): void => {
    chunks.push(...parts);
  };

  // One frame per node that has joined children (arrays). Property slots do
  // not need counting (their separators are fixed punctuation).
  interface Frame {
    kind: string;
    counts: Record<string, number>;
    opened: boolean;
  }
  const frames: Frame[] = [];
  const frame = (kind: string): Frame => ({
    kind,
    counts: {},
    opened: false,
  });

  let depth = 0;
  let directed = true;

  const nl = (): void => push(EOL, PAD.repeat(depth));

  const commentPadding: Record<CommentKind, string> = {
    Block: ' * ',
    Macro: '# ',
    Slash: '// ',
  };

  /** Emit the separator that precedes a child in an array slot. */
  const beforeArrayChild = (
    parentKind: string,
    slotName: string,
    index: number,
    parentNode: unknown,
  ): void => {
    if (slotName === 'targets') {
      if (index > 0) push(directed ? ' -> ' : ' -- ');
      return;
    }
    // children slots
    if (index === 0) {
      const ownerFrame = frames[frames.length - 1];
      if (parentKind === 'Node') {
        push(' [');
        depth++;
        if (ownerFrame) ownerFrame.opened = true;
        nl();
      } else if (parentKind === 'Edge' && edgeNeedsBracket(parentNode)) {
        push(' [');
        depth++;
        if (ownerFrame) ownerFrame.opened = true;
        nl();
      } else if (parentKind === 'Graph' || parentKind === 'Subgraph') {
        push(' {');
        depth++;
        if (ownerFrame) ownerFrame.opened = true;
        nl();
      }
      return;
    }
    push(parentKind === 'NodeRefGroup' ? ' ' : EOL + PAD.repeat(depth));
  };

  walk(astNodeAdapter, root, {
    enter(arg0: ASTVisitContext) {
      const v = arg0 as ASTVisitContext;
      const parentKind =
        v.path.length > 1 ? v.path[v.path.length - 2]?.kind : undefined;

      // ---- separators for the child we are about to visit ----
      if (v.slot && parentKind) {
        if (v.slot.container === 'array') {
          const f = frames[frames.length - 1];
          const seen = f?.counts[v.slot.name] ?? 0;
          beforeArrayChild(parentKind, v.slot.name, seen, v.path[v.path.length - 2]?.node);
          if (f) f.counts[v.slot.name] = seen + 1;
        } else if (v.slot.container === 'property') {
          // Property children are visited in declared slot order; emit fixed
          // punctuation for value/port/compass. `id` needs no punctuation
          // (keyword space already emitted).
          if (v.slot.name === 'value') push(' = ');
          else if (v.slot.name === 'port' || v.slot.name === 'compass') {
            push(':');
          }
        }
      }

      switch (v.kind) {
        case 'Literal': {
          const n = v.node;
          if (n.quoted === 'html') push('<', n.value, '>');
          else if (n.quoted === true) push('"', escape(n.value), '"');
          else push(n.value);
          return;
        }
        case 'Comment': {
          const n = v.node;
          const p = commentPadding[n.kind];
          if (n.kind === 'Block') { push('/**'); nl(); }
          const lines = escapeComment(n.value, n.kind).split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            push(p, lines[i]);
            if (i < lines.length - 1) nl();
          }
          if (n.kind === 'Block') {
            nl();
            push(' */');
          }
          return;
        }
        case 'Attribute':
          // children are key(property) then value(property); `;` on leave.
          return;
        case 'AttributeList': {
          const n = v.node;
          frames.push(frame('AttributeList'));
          if (n.children.length === 0) {
            push(`${n.kind.toLocaleLowerCase()} [];`);
            return;
          }
          push(`${n.kind.toLocaleLowerCase()} [`);
          depth++;
          const alFrame = frames[frames.length - 1];
          if (alFrame) alFrame.opened = true;
          nl();
          return;
        }
        case 'NodeRefGroup':
          frames.push(frame('NodeRefGroup'));
          push('{');
          return;
        case 'NodeRef':
          // property children: id, port?, compass? (colons handled above).
          return;
        case 'Node':
          // id property visited first; the ` [` opens lazily before the first
          // attribute child (see beforeArrayChild).
          frames.push(frame('Node'));
          return;
        case 'Edge':
          frames.push(frame('Edge'));
          frames[frames.length - 1].counts.targets = 0;
          frames[frames.length - 1].counts.children = 0;
          return;
        case 'Subgraph': {
          const n = v.node;
          frames.push(frame('Subgraph'));
          push('subgraph');
          if (n.id) push(' ');
          return;
        }
        case 'Graph': {
          const n = v.node;
          directed = n.directed;
          frames.push(frame('Graph'));
          if (n.strict) push('strict ');
          push(n.directed ? 'digraph' : 'graph');
          if (n.id) push(' ');
          return;
        }
        case 'Dot':
          frames.push(frame('Dot'));
          return;
        default:
          return;
      }
    },
    leave(arg0: ASTVisitContext) {
      const v = arg0 as ASTVisitContext;
      const close = (
        f: Frame | undefined,
        emptySuffix: string,
        closeSuffix: string,
      ): void => {
        if (f?.opened) {
          depth--;
          push(EOL, PAD.repeat(depth));
          push(closeSuffix);
        } else {
          push(emptySuffix);
        }
      };
      switch (v.kind) {
        case 'Attribute':
          push(';');
          return;
        case 'AttributeList': {
          const n = v.node;
          const f = frames.pop();
          if (f?.opened) {
            depth--;
            push(EOL, PAD.repeat(depth));
          }
          if (n.children.length > 0) push('];');
          else if (!f?.opened) {
            // empty form was fully emitted in enter
          }
          return;
        }
        case 'NodeRefGroup':
          frames.pop();
          push('}');
          return;
        case 'NodeRef':
          return;
        case 'Node': {
          const f = frames.pop();
          if (f?.opened) {
            depth--;
            push(EOL, PAD.repeat(depth));
            push('];');
          } else {
            push(';');
          }
          return;
        }
        case 'Edge': {
          const f = frames.pop();
          if (f?.opened) {
            depth--;
            push(EOL, PAD.repeat(depth));
            push('];');
          } else {
            push(';');
          }
          return;
        }
        case 'Subgraph': {
          const f = frames.pop();
          close(f, ' {}', '}');
          return;
        }
        case 'Dot':
          frames.pop();
          return;
        case 'Graph': {
          const f = frames.pop();
          close(f, ' {}', '}');
          return;
        }
        default:
          return;
      }
    },
  });

  return chunks.join('');
}

// Edge opens an attribute bracket iff it has attribute children. We cannot
// read the edge node inside the pure separator helper's closure cheaply, so a
// small lookup is provided.
const edgeNeedsBracket = (node: unknown): boolean =>
  Array.isArray((node as { children?: unknown[] }).children) &&
  ((node as { children: unknown[] }).children.length > 0);
