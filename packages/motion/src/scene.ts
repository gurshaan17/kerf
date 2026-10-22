import { z } from 'zod';

const colour = z.string().min(1).max(120);

const common = {
  x: z.number().min(-1_000).max(1_000).default(0),
  y: z.number().min(-1_000).max(1_000).default(0),
  rotation: z.number().min(-36_000).max(36_000).default(0),
  opacity: z.number().min(0).max(1).default(1),
};

const boxNodeSchema = z.object({
  type: z.literal('box'),
  ...common,
  width: z.number().min(0).max(1_000).default(20),
  height: z.number().min(0).max(1_000).default(10),
  fill: colour.default('#c9a46a'),
  stroke: colour.nullable().default(null),
  strokeWidth: z.number().min(0).max(100).default(0),
  radius: z.number().min(0).max(100).default(0),
});

const ellipseNodeSchema = z.object({
  type: z.literal('ellipse'),
  ...common,
  width: z.number().min(0).max(1_000).default(20),
  height: z.number().min(0).max(1_000).default(20),
  fill: colour.default('#c9a46a'),
  stroke: colour.nullable().default(null),
  strokeWidth: z.number().min(0).max(100).default(0),
});

const textNodeSchema = z.object({
  type: z.literal('text'),
  ...common,
  text: z.string().max(2_000),
  fontSize: z.number().min(0.1).max(100).default(6),
  fontFamily: z.string().max(200).default('Inter, system-ui, sans-serif'),
  fontWeight: z.union([z.number(), z.string()]).default(500),
  color: colour.default('#f2efe9'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  maxWidth: z.number().min(0).max(1_000).nullable().default(null),
  lineHeight: z.number().min(0.5).max(4).default(1.2),
});

const imageNodeSchema = z.object({
  type: z.literal('image'),
  ...common,
  assetId: z.string().min(1),
  width: z.number().min(0).max(1_000).default(20),
  height: z.number().min(0).max(1_000).default(20),
  fit: z.enum(['cover', 'contain']).default('cover'),
});

export const sceneNodeSchema = z.discriminatedUnion('type', [
  boxNodeSchema,
  ellipseNodeSchema,
  textNodeSchema,
  imageNodeSchema,
]);

export const sceneTreeSchema = z.object({
  background: colour.nullable().default(null),
  nodes: z.array(sceneNodeSchema).max(500).default([]),
});

export type BoxNode = z.infer<typeof boxNodeSchema>;
export type EllipseNode = z.infer<typeof ellipseNodeSchema>;
export type TextNode = z.infer<typeof textNodeSchema>;
export type ImageNode = z.infer<typeof imageNodeSchema>;
export type SceneNode = z.infer<typeof sceneNodeSchema>;
export type SceneTree = z.infer<typeof sceneTreeSchema>;

export interface SceneImageMap {
  readonly get?: (assetId: string) => CanvasImageSource | null;
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: SceneNode,
  width: number,
  height: number,
  images?: SceneImageMap,
): void {
  context.save();
  context.translate((node.x / 100) * width, (node.y / 100) * height);
  if (node.rotation !== 0) {
    context.rotate((node.rotation * Math.PI) / 180);
  }
  context.globalAlpha *= node.opacity;
  if (node.type === 'box') {
    const boxWidth = (node.width / 100) * width;
    const boxHeight = (node.height / 100) * height;
    const radius = (node.radius / 100) * Math.min(width, height);
    context.beginPath();
    if (radius > 0 && 'roundRect' in context) {
      context.roundRect(0, 0, boxWidth, boxHeight, radius);
    } else {
      context.rect(0, 0, boxWidth, boxHeight);
    }
    context.fillStyle = node.fill;
    context.fill();
    if (node.stroke && node.strokeWidth > 0) {
      context.strokeStyle = node.stroke;
      context.lineWidth = node.strokeWidth;
      context.stroke();
    }
  } else if (node.type === 'ellipse') {
    const radiusX = (node.width / 200) * width;
    const radiusY = (node.height / 200) * height;
    context.beginPath();
    context.ellipse(radiusX, radiusY, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = node.fill;
    context.fill();
    if (node.stroke && node.strokeWidth > 0) {
      context.strokeStyle = node.stroke;
      context.lineWidth = node.strokeWidth;
      context.stroke();
    }
  } else if (node.type === 'text') {
    context.fillStyle = node.color;
    context.font = `${node.fontWeight} ${(node.fontSize / 100) * height}px ${node.fontFamily}`;
    context.textBaseline = 'top';
    context.textAlign = node.align;
    context.fillText(
      node.text,
      0,
      0,
      node.maxWidth === null ? undefined : (node.maxWidth / 100) * width,
    );
  } else {
    const image = images?.get?.(node.assetId);
    const imageWidth = (node.width / 100) * width;
    const imageHeight = (node.height / 100) * height;
    if (image) {
      context.beginPath();
      context.rect(0, 0, imageWidth, imageHeight);
      context.clip();
      const sourceWidth = 'width' in image ? Number(image.width) : imageWidth;
      const sourceHeight =
        'height' in image ? Number(image.height) : imageHeight;
      const scale =
        node.fit === 'cover'
          ? Math.max(imageWidth / sourceWidth, imageHeight / sourceHeight)
          : Math.min(imageWidth / sourceWidth, imageHeight / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      context.drawImage(
        image,
        (imageWidth - drawWidth) / 2,
        (imageHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    } else {
      context.fillStyle = 'rgba(201, 164, 106, 0.14)';
      context.fillRect(0, 0, imageWidth, imageHeight);
    }
  }
  context.restore();
}

export function renderSceneTree(
  context: CanvasRenderingContext2D,
  tree: SceneTree,
  width: number,
  height: number,
  images?: SceneImageMap,
): void {
  const parsed = sceneTreeSchema.parse(tree);
  context.save();
  context.clearRect(0, 0, width, height);
  if (parsed.background) {
    context.fillStyle = parsed.background;
    context.fillRect(0, 0, width, height);
  }
  for (const node of parsed.nodes) {
    drawNode(context, node, width, height, images);
  }
  context.restore();
}
