import { parse } from 'acorn';
import type { Node } from 'acorn';

export const COMPOSITION_SOURCE_LIMIT = 60_000;

const DENY_IDENTIFIERS = new Set([
  'window',
  'document',
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'importScripts',
  'eval',
  'Function',
  'process',
  'require',
  'module',
  'exports',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'location',
  'history',
  'postMessage',
  'open',
  'close',
  'alert',
  'prompt',
  'confirm',
  'constructor',
  '__proto__',
  'prototype',
]);

const ALLOWED_MATH = new Set([
  'abs',
  'round',
  'floor',
  'ceil',
  'min',
  'max',
  'sin',
  'cos',
  'tan',
  'sqrt',
  'pow',
  'PI',
  'E',
]);

const ALLOWED_NODES = new Set([
  'ObjectExpression',
  'ArrayExpression',
  'Property',
  'Literal',
  'TemplateLiteral',
  'TemplateElement',
  'UnaryExpression',
  'BinaryExpression',
  'LogicalExpression',
  'ConditionalExpression',
  'Identifier',
  'MemberExpression',
  'CallExpression',
]);

export interface PolicyIssue {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export type PolicyResult =
  | { readonly ok: true; readonly source: string; readonly ast: unknown }
  | { readonly ok: false; readonly issues: PolicyIssue[] };

function issueFor(node: Node, message: string): PolicyIssue {
  const location = (
    node as Node & {
      loc?: { start: { line: number; column: number } };
    }
  ).loc;
  return {
    message,
    line: location?.start.line ?? 1,
    column: (location?.start.column ?? 0) + 1,
  };
}

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function childNode(value: unknown): AstNode | null {
  return value && typeof value === 'object' && 'type' in value
    ? (value as AstNode)
    : null;
}

function walk(
  node: AstNode | null | undefined,
  issues: PolicyIssue[],
  propertyKey = false,
): void {
  if (!node) {
    return;
  }
  if (!ALLOWED_NODES.has(node.type)) {
    issues.push(
      issueFor(
        node as unknown as Node,
        `Syntax "${node.type}" is not allowed.`,
      ),
    );
    return;
  }
  if (node.type === 'Identifier') {
    const name = String(node.name ?? '');
    if (!propertyKey && DENY_IDENTIFIERS.has(name)) {
      issues.push(
        issueFor(node as unknown as Node, `"${name}" is not available here.`),
      );
    }
    return;
  }
  const computed = node.computed === true;
  if (node.type === 'MemberExpression') {
    const object = childNode(node.object);
    const property = childNode(node.property);
    if (
      object?.type !== 'Identifier' ||
      object.name !== 'Math' ||
      property?.type !== 'Identifier' ||
      !ALLOWED_MATH.has(String(property.name)) ||
      computed
    ) {
      issues.push(
        issueFor(
          node as unknown as Node,
          'Only whitelisted Math properties may be read.',
        ),
      );
    }
    return;
  }
  if (node.type === 'CallExpression') {
    const callee = childNode(node.callee);
    const object = callee ? childNode(callee.object) : null;
    const property = callee ? childNode(callee.property) : null;
    if (
      callee?.type !== 'MemberExpression' ||
      object?.type !== 'Identifier' ||
      object.name !== 'Math' ||
      property?.type !== 'Identifier' ||
      !ALLOWED_MATH.has(String(property.name)) ||
      callee.computed === true
    ) {
      issues.push(
        issueFor(
          (callee ?? node) as unknown as Node,
          'Only whitelisted Math functions may be called.',
        ),
      );
    }
    for (const argument of Array.isArray(node.arguments)
      ? node.arguments
      : []) {
      const child = childNode(argument);
      if (child) {
        if (child.type === 'SpreadElement') {
          issues.push(
            issueFor(
              child as unknown as Node,
              'Spread arguments are not allowed.',
            ),
          );
        } else {
          walk(child, issues);
        }
      }
    }
    return;
  }
  if (node.type === 'Property') {
    if (computed) {
      issues.push(
        issueFor(
          node as unknown as Node,
          'Computed object keys are not allowed.',
        ),
      );
    }
    const key = childNode(node.key);
    const value = childNode(node.value);
    if (key?.type === 'Identifier' && value?.type === 'Identifier') {
      walk(value, issues);
    } else {
      walk(key, issues, true);
      walk(value, issues);
    }
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'type' ||
      key === 'start' ||
      key === 'end' ||
      key === 'loc' ||
      key === 'range'
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = childNode(item);
        if (child) {
          walk(child, issues);
        }
      }
    } else {
      const child = childNode(value);
      if (child) {
        walk(child, issues);
      }
    }
  }
}

export function validateCompositionSource(source: string): PolicyResult {
  if (source.trim().length === 0) {
    return {
      ok: false,
      issues: [
        { message: 'The composition source is empty.', line: 1, column: 1 },
      ],
    };
  }
  if (source.length > COMPOSITION_SOURCE_LIMIT) {
    return {
      ok: false,
      issues: [
        {
          message: `The composition source exceeds ${COMPOSITION_SOURCE_LIMIT} characters.`,
          line: 1,
          column: 1,
        },
      ],
    };
  }
  let node: Node;
  try {
    const program = parse(source, {
      ecmaVersion: 'latest',
      locations: true,
    });
    const statement = program.body[0];
    if (
      program.body.length !== 1 ||
      !statement ||
      statement.type !== 'ExpressionStatement'
    ) {
      return {
        ok: false,
        issues: [
          {
            message: 'The composition must be a single expression.',
            line: statement?.loc?.start.line ?? 1,
            column: (statement?.loc?.start.column ?? 0) + 1,
          },
        ],
      };
    }
    node = statement.expression;
  } catch (error) {
    const location = (error as { loc?: { line: number; column: number } }).loc;
    return {
      ok: false,
      issues: [
        {
          message:
            error instanceof Error
              ? error.message
              : 'The source could not be parsed.',
          line: location?.line ?? 1,
          column: (location?.column ?? 0) + 1,
        },
      ],
    };
  }
  const issues: PolicyIssue[] = [];
  walk(node as unknown as AstNode, issues);
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, source, ast: node };
}
