import { audioGainPoints } from '@kerf/model';
import type { AudibleClip } from '@kerf/model';

/** FFmpeg t starts at the cropped export input's timeline position. */
export function audioGainExpression(
  clip: AudibleClip,
  fps: number,
  offsetFrames: number,
): string {
  const points = audioGainPoints(clip);
  const t = `(t*${fps.toFixed(9)}+${offsetFrames})`;
  let expression = String(points.at(-1)!.value);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const value =
      Math.abs(a.value - b.value) < 1e-12
        ? `${a.value}`
        : `(${a.value}+(${b.value - a.value})*(${t}-${a.frame})/${b.frame - a.frame})`;
    expression = `if(lt(${t},${b.frame}),${value},${expression})`;
  }
  return expression;
}
