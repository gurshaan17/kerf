import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPOSITION_SOURCE } from '@kerf/model';
import { interpretSceneExpression } from './interpret';
import { validateCompositionSource } from './policy';
import { sceneTreeSchema } from './scene';

function astFor(source: string): unknown {
  const policy = validateCompositionSource(source);
  if (!policy.ok) {
    throw new Error(policy.issues.map((issue) => issue.message).join('\n'));
  }
  return policy.ast;
}

describe('scene expression interpreter', () => {
  it('evaluates the default composition without host globals', () => {
    const tree = sceneTreeSchema.parse(
      interpretSceneExpression(astFor(DEFAULT_COMPOSITION_SOURCE)),
    );
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes[0]).toMatchObject({ type: 'box', fill: '#c9a46a' });
    expect(tree.nodes[1]).toMatchObject({ type: 'text' });
  });

  it('uses frame and time in deterministic expressions', () => {
    const source =
      '({ nodes: [{ type: "text", text: `frame ${frame}`, x: Math.round(time * 10), opacity: frame > 4 ? 0.5 : 1 }] })';
    const tree = sceneTreeSchema.parse(
      interpretSceneExpression(astFor(source), 6, 1.25),
    );
    expect(tree.nodes[0]).toMatchObject({
      text: 'frame 6',
      x: 13,
      opacity: 0.5,
    });
  });

  it('rejects unknown identifiers and prototype keys', () => {
    expect(() =>
      interpretSceneExpression(astFor('({ nodes: window })')),
    ).toThrow(/not available|Syntax/);
    expect(() =>
      interpretSceneExpression(astFor('({ __proto__: { nodes: [] } })')),
    ).toThrow(/cannot be used/);
  });
});
