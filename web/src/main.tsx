import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.js';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error("index.html is missing the #root element the app mounts into.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
