import React from 'react';
import { createRoot } from 'react-dom/client';
import '@kerf/ui';
import App from './App';
import { StudioProvider } from './state/StudioProvider';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <StudioProvider bridge={window.kerf}>
      <App />
    </StudioProvider>
  </React.StrictMode>,
);
