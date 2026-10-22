import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPOSITION_SOURCE } from '@kerf/model';
import { sceneTreeSchema } from './scene';

function defaultTree(): unknown {
  return new Function(`return (${DEFAULT_COMPOSITION_SOURCE});`)();
}

describe('scene tree schema', () => {
  it('parses rendered boxes and text with percentage geometry', () => {
    const tree = sceneTreeSchema.parse(defaultTree());
    expect(tree.background).toBe('#111315');
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes[0]).toMatchObject({
      type: 'box',
      x: 8,
      y: 74,
      width: 46,
      height: 14,
    });
    expect(tree.nodes[1]).toMatchObject({
      type: 'text',
      text: 'Kerf composition',
    });
  });

  it('rejects unknown nodes and out-of-range opacity', () => {
    expect(
      sceneTreeSchema.safeParse({
        nodes: [{ type: 'script', x: 0, y: 0 }],
      }).success,
    ).toBe(false);
    expect(
      sceneTreeSchema.safeParse({
        nodes: [{ type: 'box', opacity: 2 }],
      }).success,
    ).toBe(false);
  });

  it('caps node count and defaults missing geometry', () => {
    const nodes = Array.from({ length: 501 }, () => ({ type: 'box' }));
    expect(sceneTreeSchema.safeParse({ nodes }).success).toBe(false);
    const tree = sceneTreeSchema.parse({ nodes: [{ type: 'box' }] });
    expect(tree.nodes[0]).toMatchObject({
      type: 'box',
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
  });
});
