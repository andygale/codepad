import { Configuration } from "@azure/msal-browser";

// Get the current domain for redirect URI
const getRedirectUri = () => {
  // The app is always served from the same host as the API.
  // This dynamically constructs the redirect URI based on the current location.
  return `${window.location.protocol}//${window.location.host}/`;
};

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.REACT_APP_MICROSOFT_CLIENT_ID || "7d539d3e-b9fa-4ec7-b8e9-ab88ec1db4af",
    authority: `https://login.microsoftonline.com/${process.env.REACT_APP_MICROSOFT_TENANT_ID || "cf3dc8a2-b7cc-4452-848f-cb570a56cfbf"}`,
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