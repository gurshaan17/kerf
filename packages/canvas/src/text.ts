import type { TextStyle } from '@kerf/model';

/** Applies a text style to a 2D context, including optional letter spacing. */
export function setFont(
  context: CanvasRenderingContext2D,
  style: TextStyle,
): void {
  context.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
  const withSpacing = context as CanvasRenderingContext2D & {
    letterSpacing?: string;
  };
  withSpacing.letterSpacing = `${style.letterSpacing}px`;
}

/** Wraps text into lines that fit `maxWidth` using the context's current font. */
export function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (
        current.length > 0 &&
        context.measureText(candidate).width > maxWidth
      ) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) {
      lines.push(current);
    }
  }
  return lines;
}
