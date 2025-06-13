import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Suppress ResizeObserver loop errors in development
window.addEventListener('error', function (e) {
  if (
    e.message &&
    (e.message.includes('ResizeObserver loop completed with undelivered notifications.') ||
     e.message.includes('ResizeObserver loop limit exceeded'))
  ) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

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
