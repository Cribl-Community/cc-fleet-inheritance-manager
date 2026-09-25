import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@capra/theme/base.css';
import '@capra/core/styles.css';
import '@capra/icons/styles.css';
import App from './App';
import './App.css';

/**
 * Theme bridge: sync Cribl shell's dark/light mode with this app
 * The Cribl platform sends CRIBL_APP_LAYOUT messages with the current theme
 */
function installThemeBridge(): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: string; theme?: 'light' | 'dark' } | null;
    if (data?.type !== 'CRIBL_APP_LAYOUT') return;
    if (data.theme !== 'light' && data.theme !== 'dark') return;
    document.body.classList.toggle('dark', data.theme === 'dark');
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

// Install theme bridge before rendering
installThemeBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
