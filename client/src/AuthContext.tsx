import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useMsal } from "@azure/msal-react";
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
  fetchUser: () => Promise<void>;
  initializeAuth: () => Promise<void>;
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
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const isAuthenticated = user !== null;

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

  const initializeAuth = useCallback(async () => {
    if (initialized) return;
    
    setLoading(true);
    setInitialized(true);
    
    try {
      // First try to get user from existing session
      const response = await axios.get<User>(`${API_URL}/api/auth/me`, {
        withCredentials: true,
      });
      setUser(response.data);
    } catch (error) {
      // If no backend session but we have MSAL accounts, try to get a token
      if (accounts.length > 0) {
        try {
          const silentRequest = {
            ...loginRequest,
            account: accounts[0]
          };
          const response = await instance.acquireTokenSilent(silentRequest);
          
          // Send the token to backend to create session
          await axios.post(`${API_URL}/api/auth/callback`, { token: response.idToken }, {
            withCredentials: true
          });
          
          // Try fetching user again
          const userResponse = await axios.get<User>(`${API_URL}/api/auth/me`, {
            withCredentials: true,
          });
          setUser(userResponse.data);
        } catch (tokenError) {
          console.error('Silent token acquisition failed:', tokenError);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [instance, accounts, initialized]);

  const login = () => {
    instance.loginRedirect(loginRequest).catch(e => {
      console.error('MSAL loginRedirect error:', e);
    });
  };

  const logout = () => {
    instance.logoutRedirect({
      postLogoutRedirectUri: "/",
    });
    axios.post(`${API_URL}/api/auth/logout`, {}, { withCredentials: true });
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated,
    login,
    logout,
    loading,
    fetchUser,
    initializeAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}; 