import {
  interpretSceneExpression,
  sceneTreeSchema,
  validateCompositionSource,
  type SceneTree,
} from '@kerf/motion';

interface PendingEvaluation {
  readonly resolve: (tree: SceneTree) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface CompositionSandbox {
  evaluate(source: string, frame?: number, time?: number): Promise<SceneTree>;
  dispose(): void;
}

/**
 * The iframe bootstrap has no network, DOM or host access of its own. It only
 * interprets the AST that the policy already approved, so the source never
 * reaches `eval` or `new Function`.
 */
const SANDBOX_NONCE = 'kerf-motion-bootstrap';
const SANDBOX_RUNTIME = `
var interpret = ${interpretSceneExpression.toString()};
window.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.type !== 'kerf:motion:evaluate') return;
  try {
    var tree = interpret(data.ast, data.frame, data.time);
    window.parent.postMessage({ type: 'kerf:motion:result', id: data.id, tree: tree }, '*');
  } catch (error) {
    window.parent.postMessage({
      type: 'kerf:motion:result',
      id: data.id,
      error: error && error.message ? String(error.message) : String(error)
    }, '*');
  }
});
window.parent.postMessage({ type: 'kerf:motion:ready' }, '*');
`;

export async function createCompositionSandbox(): Promise<CompositionSandbox> {
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${SANDBOX_NONCE}';">`,
    '</head><body>',
    `<script nonce="${SANDBOX_NONCE}">${SANDBOX_RUNTIME}</script>`,
    '</body></html>',
  ].join('');
  const pageUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  const pending = new Map<string, PendingEvaluation>();
  let disposed = false;

  const cleanup = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    window.removeEventListener('message', onMessage);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('The composition sandbox was closed.'));
    }
    pending.clear();
    iframe.remove();
    URL.revokeObjectURL(pageUrl);
  };

  function onMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) {
      return;
    }
    const data = event.data as {
      type?: string;
      id?: string;
      tree?: unknown;
      error?: string;
    } | null;
    if (!data || data.type !== 'kerf:motion:result' || !data.id) {
      return;
    }
    const item = pending.get(data.id);
    if (!item) {
      return;
    }
    pending.delete(data.id);
    clearTimeout(item.timer);
    if (data.error) {
      item.reject(new Error(data.error));
      return;
    }
    try {
      item.resolve(sceneTreeSchema.parse(data.tree));
    } catch (error) {
      item.reject(
        error instanceof Error
          ? error
          : new Error('The composition returned an invalid scene tree.'),
      );
    }
  }

  window.addEventListener('message', onMessage);
  document.body.append(iframe);

  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The composition sandbox did not start.'));
    }, 3_000);
    const ready = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) {
        return;
      }
      if (event.data?.type === 'kerf:motion:ready') {
        clearTimeout(timer);
        window.removeEventListener('message', ready);
        resolvePromise();
      }
    };
    // A blob document can announce readiness as soon as its script runs, so
    // the listener must exist before the iframe is allowed to navigate.
    window.addEventListener('message', ready);
    iframe.src = pageUrl;
  });

  return {
    evaluate(source, frame = 0, time = 0) {
      if (disposed) {
        return Promise.reject(new Error('The composition sandbox is closed.'));
      }
      const policy = validateCompositionSource(source);
      if (!policy.ok) {
        const first = policy.issues[0];
        return Promise.reject(
          new Error(
            first
              ? `${first.message} (line ${first.line}, column ${first.column})`
              : 'The composition source is not allowed.',
          ),
        );
      }
      const id = crypto.randomUUID();
      return new Promise<SceneTree>((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('The composition took longer than 1.5 seconds.'));
        }, 1_500);
        pending.set(id, { resolve: resolvePromise, reject, timer });
        iframe.contentWindow?.postMessage(
          {
            type: 'kerf:motion:evaluate',
            id,
            ast: policy.ast,
            frame,
            time,
          },
          '*',
        );
      });
    },
    dispose: cleanup,
  };
}
