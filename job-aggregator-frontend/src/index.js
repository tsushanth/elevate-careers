import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Privacy from './Privacy';

const path = window.location.pathname;
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {path === '/privacy' ? <Privacy /> : <App />}
  </React.StrictMode>
);