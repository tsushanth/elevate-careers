import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App';
import Privacy from './Privacy';
import DeleteAccount from './DeleteAccount';
import CompanyPage from './CompanyPage';
import ResumeCheck from './ResumeCheck';
import Admin from './Admin';

// Capture traffic source on first page load — persists through auth flow
(function captureSource() {
  if (sessionStorage.getItem('sa_source')) return;
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

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/delete-account" element={<DeleteAccount />} />
        <Route path="/resume-check" element={<ResumeCheck />} />
        <Route path="/companies/:slug" element={<CompanyPage />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);