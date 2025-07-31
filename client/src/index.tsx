import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from './authConfig';
import { BrowserRouter as Router } from 'react-router-dom';
import { AuthProvider } from './AuthContext';

const msalInstance = new PublicClientApplication(msalConfig);

msalInstance.initialize().then(() => {
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );
  root.render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <Router>
          <AuthProvider>
            <App />
          </AuthProvider>
        </Router>
      </MsalProvider>
    </React.StrictMode>
  );
}).catch((error) => {
  console.error('MSAL initialization error:', error);
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

// Suppress ResizeObserver loop errors in development
const suppressedErrors = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded'
];

const origError = window.onerror;
window.onerror = function (message, ...args) {
  if (typeof message === 'string' && suppressedErrors.some(e => message.includes(e))) {
    return true; // Suppress error
  }
  if (origError) return origError(message, ...args);
};
