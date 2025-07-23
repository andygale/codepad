import { Configuration } from "@azure/msal-browser";

export const msalConfig: Configuration = {
  auth: {
    clientId: "7d539d3e-b9fa-4ec7-b8e9-ab88ec1db4af",
    authority: "https://login.microsoftonline.com/cf3dc8a2-b7cc-4452-848f-cb570a56cfbf",
    redirectUri: "http://localhost:5000"
  },
  cache: {
    cacheLocation: "sessionStorage", // This is more secure than localStorage
    storeAuthStateInCookie: false, 
  }
};

export const loginRequest = {
  scopes: ["User.Read", "email", "profile"]
}; 