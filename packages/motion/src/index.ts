/** Public surface for the @kerf/motion package. */
export { COMPOSITION_SOURCE_LIMIT, validateCompositionSource } from './policy';
export type { PolicyIssue, PolicyResult } from './policy';
export { interpretSceneExpression } from './interpret';
export { sceneNodeSchema, sceneTreeSchema, renderSceneTree } from './scene';
export type {
  BoxNode,
  EllipseNode,
  ImageNode,
  SceneImageMap,
  SceneNode,
  SceneTree,
  TextNode,
} from './scene';
