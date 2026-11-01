import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './cosmic.css';
import './components/workspace-chrome.css';
import './components/evidence-views.css';
import './components/plan-map.css';
import './components/file-drop-zone.css';
import './pages/teaching.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
