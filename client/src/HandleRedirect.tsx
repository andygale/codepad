import { useEffect } from 'react';
import { useMsal } from "@azure/msal-react";
import axios from 'axios';
import { useAuth } from './AuthContext';

const API_URL = process.env.REACT_APP_API_URL || '';

const HandleRedirect = () => {
  const { instance } = useMsal();
  const { fetchUser } = useAuth();

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        // Only handle redirect if we're actually coming back from one
        const result = await instance.handleRedirectPromise();
        if (result) {
          try {
            const response = await axios.post(`${API_URL}/api/auth/callback`, { token: result.idToken });
            // After successful callback, fetch the user data from our session
            await fetchUser();
          } catch (apiError) {
            console.error('API callback error:', apiError);
          }
        }
      } catch (error) {
        console.error('MSAL redirect error:', error);
      }
    };

    handleRedirect();
  }, [instance, fetchUser]);

  return null; // This component does not render anything
};

export default HandleRedirect; 