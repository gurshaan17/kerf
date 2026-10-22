/**
 * Evaluate a policy-checked composition expression without JavaScript eval.
 *
 * The policy validator is the first boundary. This interpreter is the second:
 * it only understands literals, containers, arithmetic, conditionals and the
 * whitelisted Math surface. Keeping it dependency-free and self-contained lets
 * the sandbox serialise the function into its iframe bootstrap.
 */
export function interpretSceneExpression(
  ast: unknown,
  frame = 0,
  time = 0,
): unknown {
  const allowedMath = new Set([
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
  const deniedKeys = new Set(['__proto__', 'constructor', 'prototype']);

  function fail(message: string): never {
    throw new Error(message);
  }

  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return fail('The composition contains an invalid expression.');
    }
    return value as Record<string, unknown>;
  }

  function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  function evaluate(value: unknown): unknown {
    const node = record(value);
    switch (node.type) {
      case 'Literal':
        return node.value;
      case 'Identifier': {
        const name = String(node.name ?? '');
        if (name === 'frame') {
          return frame;
        }
        if (name === 'time') {
          return time;
        }
        if (name === 'undefined') {
          return undefined;
        }
        return fail(`"${name}" is not available in a composition.`);
      }
      case 'TemplateLiteral': {
        const quasis = list(node.quasis);
        const expressions = list(node.expressions);
        let output = '';
        for (let index = 0; index < quasis.length; index += 1) {
          const quasi = record(quasis[index]);
          output += String(record(quasi.value).cooked ?? '');
          if (index < expressions.length) {
            output += String(evaluate(expressions[index]));
          }
        }
        return output;
      }
      case 'ArrayExpression':
        return list(node.elements).map((element) =>
          element === null ? null : evaluate(element),
        );
      case 'ObjectExpression': {
        const output: Record<string, unknown> = {};
        for (const property of list(node.properties)) {
          const item = record(property);
          if (item.type !== 'Property' || item.computed === true) {
            return fail('Only plain object properties are allowed.');
          }
          const key = record(item.key);
          const name =
            key.type === 'Identifier'
              ? String(key.name ?? '')
              : String(key.value ?? '');
          if (deniedKeys.has(name)) {
            return fail(`"${name}" cannot be used as a property name.`);
          }
          output[name] = evaluate(item.value);
        }
        return output;
      }
      case 'UnaryExpression': {
        const argument = evaluate(node.argument);
        switch (node.operator) {
          case '-':
            return -(argument as number);
          case '+':
            return +(argument as number);
          case '!':
            return !argument;
          case '~':
            return ~(argument as number);
          case 'typeof':
            return typeof argument;
          case 'void':
            return undefined;
          default:
            return fail(
              `The unary operator "${String(node.operator)}" is not allowed.`,
            );
        }
      }
      case 'BinaryExpression': {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        switch (node.operator) {
          case '+':
            return (left as number) + (right as number);
          case '-':
            return (left as number) - (right as number);
          case '*':
            return (left as number) * (right as number);
          case '/':
            return (left as number) / (right as number);
          case '%':
            return (left as number) % (right as number);
          case '**':
            return (left as number) ** (right as number);
          case '<':
            return (left as number) < (right as number);
          case '<=':
            return (left as number) <= (right as number);
          case '>':
            return (left as number) > (right as number);
          case '>=':
            return (left as number) >= (right as number);
          case '==':
            return left == right;
          case '!=':
            return left != right;
          case '===':
            return left === right;
          case '!==':
            return left !== right;
          case '|':
            return (left as number) | (right as number);
          case '&':
            return (left as number) & (right as number);
          case '^':
            return (left as number) ^ (right as number);
          case '<<':
            return (left as number) << (right as number);
          case '>>':
            return (left as number) >> (right as number);
          case '>>>':
            return (left as number) >>> (right as number);
          default:
            return fail(
              `The operator "${String(node.operator)}" is not allowed.`,
            );
        }
      }
      case 'LogicalExpression': {
        const left = evaluate(node.left);
        if (node.operator === '&&') {
          return left ? evaluate(node.right) : left;
        }
        if (node.operator === '||') {
          return left ? left : evaluate(node.right);
        }
        if (node.operator === '??') {
          return left === null || left === undefined
            ? evaluate(node.right)
            : left;
        }
        return fail(
          `The logical operator "${String(node.operator)}" is not allowed.`,
        );
      }
      case 'ConditionalExpression':
        return evaluate(node.test)
          ? evaluate(node.consequent)
          : evaluate(node.alternate);
      case 'MemberExpression':
      case 'CallExpression': {
        const callee =
          node.type === 'MemberExpression' ? node : record(node.callee);
        if (callee.type !== 'MemberExpression') {
          return fail('Only whitelisted Math calls are allowed.');
        }
        const object = record(callee.object);
        const property = record(callee.property);
        const name = String(property.name ?? '');
        if (
          object.type !== 'Identifier' ||
          object.name !== 'Math' ||
          callee.computed === true ||
          !allowedMath.has(name)
        ) {
          return fail('Only whitelisted Math properties may be used.');
        }
        if (node.type === 'MemberExpression') {
          return (Math as unknown as Record<string, unknown>)[name];
        }
        const args = list(node.arguments).map((argument) => evaluate(argument));
        const fn = (
          Math as unknown as Record<
            string,
            ((...values: unknown[]) => unknown) | undefined
          >
        )[name];
        if (typeof fn !== 'function') {
          return fail(`Math.${name} is not callable.`);
        }
        return fn(...args);
      }
      default:
        return fail(`Syntax "${String(node.type)}" is not allowed.`);
    }
  }

  return evaluate(ast);
}
