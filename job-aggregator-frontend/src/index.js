import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Privacy from './Privacy';

// Capture traffic source on first page load — persists through auth flow
(function captureSource() {
  if (sessionStorage.getItem('sa_source')) return; // already captured this session
  const p = new URLSearchParams(window.location.search);
  const source = {
    utm_source: p.get('utm_source') || '',
    utm_medium: p.get('utm_medium') || '',
    utm_campaign: p.get('utm_campaign') || '',
    referrer: document.referrer || '',
    landing: window.location.pathname + window.location.search,
  };
  sessionStorage.setItem('sa_source', JSON.stringify(source));
})();

const path = window.location.pathname;
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {path === '/privacy' ? <Privacy /> : <App />}
  </React.StrictMode>
);