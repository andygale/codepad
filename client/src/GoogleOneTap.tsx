import React, { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

interface GoogleOneTapProps {
  onSuccess?: () => void;
  onError?: (error: any) => void;
}

declare global {
  interface Window {
    google: any;
  }
}

const GoogleOneTap: React.FC<GoogleOneTapProps> = ({ onSuccess, onError }) => {
  const { login, isAuthenticated } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (isAuthenticated || initialized.current) return;

    const initializeGoogleOneTap = () => {
      if (!window.google) {
        console.error('Google Identity Services not loaded');
        return;
      }

      try {
        const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
        console.log('Google Client ID:', clientId ? 'Set' : 'Missing');
        
        if (!clientId) {
          console.error('REACT_APP_GOOGLE_CLIENT_ID environment variable is not set');
          onError?.(new Error('Google Client ID not configured'));
          return;
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: any) => {
            try {
              await login(response.credential);
              onSuccess?.();
            } catch (error) {
              console.error('Login error:', error);
              onError?.(error);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: false,
        });

        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-button'),
          {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            logo_alignment: 'left',
          }
        );

        // Show the One Tap prompt
        window.google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            console.log('One Tap not displayed or skipped');
          }
        });

        initialized.current = true;
      } catch (error) {
        console.error('Error initializing Google One Tap:', error);
        onError?.(error);
      }
    };

    // Load Google Identity Services script if not already loaded
    if (!window.google) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = initializeGoogleOneTap;
      script.onerror = () => {
        console.error('Failed to load Google Identity Services');
        onError?.(new Error('Failed to load Google Identity Services'));
      };
      document.head.appendChild(script);
    } else {
      initializeGoogleOneTap();
    }
  }, [login, isAuthenticated, onSuccess, onError]);

  if (isAuthenticated) {
    return null;
  }

  return <div id="google-signin-button" style={{ margin: '1rem 0' }}></div>;
};

export default GoogleOneTap; 