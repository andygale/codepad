import { Configuration } from "@azure/msal-browser";

// Get the current domain for redirect URI
const getRedirectUri = () => {
  // In production, use the current domain
  if (process.env.NODE_ENV === 'production') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  // In development, use localhost:5000 or the API URL if available
  return process.env.REACT_APP_API_URL || 'http://localhost:5000';
};

export const msalConfig: Configuration = {
  auth: {
    clientId: "7d539d3e-b9fa-4ec7-b8e9-ab88ec1db4af",
    authority: "https://login.microsoftonline.com/cf3dc8a2-b7cc-4452-848f-cb570a56cfbf",
    redirectUri: getRedirectUri()
  },
  cache: {
    cacheLocation: "sessionStorage", // This is more secure than localStorage
    storeAuthStateInCookie: false, 
  }
};

export const loginRequest = {
  scopes: ["User.Read", "email", "profile"]
}; 