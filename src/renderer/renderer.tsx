import React from 'react';
import { createRoot } from 'react-dom/client';
import '@kerf/ui';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { StudioProvider } from './state/StudioProvider';

const bootStartedAt = performance.now();
const perf = new URLSearchParams(window.location.search).has('perf');
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StudioProvider bridge={window.kerf}>
        <App />
      </StudioProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

if (perf) {
  requestAnimationFrame(() => {
    console.info(
      `[perf] renderer first frame in ${Math.round(
        performance.now() - bootStartedAt,
      )}ms`,
    );
  });
}
