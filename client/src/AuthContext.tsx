import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "./authConfig";
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { instance, accounts } = useMsal();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const msalIsAuthenticated = useIsAuthenticated();

  const fetchUser = useCallback(async () => {
    try {
      const response = await axios.get<User>(`${API_URL}/api/auth/me`, {
        withCredentials: true,
      });
      setUser(response.data);
    } catch (error) {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const handleAuth = async () => {
      setLoading(true);
      try {
        const result = await instance.handleRedirectPromise();
        if (result) {
          // We have a token from a redirect, let's process it.
          await axios.post(`${API_URL}/api/auth/callback`, { token: result.idToken }, {
            withCredentials: true
          });
          // After the backend creates a session, we can fetch the user details.
          await fetchUser();
        } else if (msalIsAuthenticated && accounts.length > 0) {
          // We are already signed in with MSAL, but might not have a backend session.
          // Let's try to get user from our backend first.
          try {
            await fetchUser();
          } catch (e) {
            // If that fails, acquire a token silently and establish a new session.
            const silentRequest = { ...loginRequest, account: accounts[0] };
            const response = await instance.acquireTokenSilent(silentRequest);
            await axios.post(`${API_URL}/api/auth/callback`, { token: response.idToken }, {
              withCredentials: true
            });
            await fetchUser();
          }
        } else {
            // No token and not signed in with MSAL. Check for an existing session.
            await fetchUser();
        }
      } catch (error) {
        console.error("Authentication failed:", error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    handleAuth();
  }, [instance, accounts, msalIsAuthenticated, fetchUser]);


  const login = () => {
    instance.loginRedirect(loginRequest).catch(e => {
      console.error('MSAL loginRedirect error:', e);
    });
  };

  const logout = () => {
    axios.post(`${API_URL}/api/auth/logout`, {}, { withCredentials: true });
    instance.logoutRedirect({
      postLogoutRedirectUri: "/",
    });
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    login,
    logout,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
