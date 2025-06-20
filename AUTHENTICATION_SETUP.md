# Google One-Tap Authentication Setup

## Overview

The application now includes Google One-Tap authentication that restricts room viewing and creation to users with `@tripadvisor.com` or `@thefork.com` email addresses. Non-authenticated users can still join existing rooms as guests.

## Features

- **Authenticated Users**: Can view room list, create new rooms, and join rooms
- **Authorized Domains**: Only `@tripadvisor.com` and `@thefork.com` emails are authorized
- **Guest Access**: Non-authenticated users can join rooms by entering a Room ID
- **Google One-Tap**: Seamless login experience with Google accounts

## Setup Instructions

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Identity and Access Management (IAM) API**
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth 2.0 Client IDs**
6. Configure the OAuth consent screen if prompted
7. Set **Application type** to "Web application"
8. Add your domain to **Authorized JavaScript origins**:
   - For development: `http://localhost:5000`
   - For production: `https://yourdomain.com`

### 2. Environment Configuration

1. Copy the client ID from Google Cloud Console
2. Create a `.env` file in the `client` directory:

```bash
cp client/.env.example client/.env
```

3. Update the `.env` file with your Google Client ID:

```env
REACT_APP_GOOGLE_CLIENT_ID=your-actual-client-id-here.apps.googleusercontent.com
REACT_APP_API_URL=
```

### 3. Testing the Authentication

1. **Start the application**:
   ```bash
   yarn build && yarn start
   ```

2. **Visit** `http://localhost:5000`

3. **Login Flow**:
   - Click "Sign in with Google" 
   - Use a `@tripadvisor.com` or `@thefork.com` email
   - You should be able to see and create rooms

4. **Guest Access**:
   - Click "join an existing room as a guest"
   - Enter a valid Room ID (UUID format)
   - You can join the room without authentication

## User Flow

### Authenticated Users (Authorized Domains)
1. Visit home page
2. See Google One-Tap login prompt
3. Login with authorized email
4. Access full functionality (view/create/join rooms)

### Authenticated Users (Unauthorized Domains)
1. Login with non-authorized email
2. See "Unauthorized Access" message
3. Option to try different account

### Guest Users
1. Visit home page
2. Click "join an existing room as a guest"
3. Enter Room ID
4. Join room with name prompt (existing flow)

## Security Notes

- JWT tokens are decoded client-side (Google handles verification)
- User sessions are stored in localStorage
- Domain validation happens on the frontend
- Room access is not restricted (guests can join any room with valid ID)

## Customization

To add more authorized domains, update the `AUTHORIZED_DOMAINS` array in `client/src/AuthContext.tsx`:

```typescript
const AUTHORIZED_DOMAINS = ['tripadvisor.com', 'thefork.com', 'yourdomain.com'];
``` 