// Google authentication service
import { OAuth2Client } from 'google-auth-library';
import { envConfig } from '../config/env';
import { logger } from '../utils/logger';

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
  verified_email: boolean;
}

// Initialize Google OAuth2 client
const oauth2Client = new OAuth2Client(
  envConfig.GOOGLE_CLIENT_ID,
  envConfig.GOOGLE_CLIENT_SECRET,
  `${envConfig.API_URL}/auth/google/callback`
);

// Generate Google OAuth URL
export const getGoogleAuthUrl = (): string => {
  try {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      include_granted_scopes: true,
    });

    return authorizationUrl;
  } catch (error) {
    logger.error('Error generating Google auth URL:', error);
    throw new Error('Failed to generate Google authentication URL');
  }
};

// Verify Google ID token
export const verifyGoogleToken = async (idToken: string): Promise<GoogleUserInfo> => {
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: envConfig.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      throw new Error('Invalid token payload');
    }

    return {
      id: payload.sub,
      email: payload.email!,
      name: payload.name!,
      picture: payload.picture,
      verified_email: payload.email_verified || false,
    };
  } catch (error) {
    logger.error('Error verifying Google token:', error);
    throw new Error('Failed to verify Google token');
  }
};

// Get user info from access token
export const getGoogleUserInfo = async (accessToken: string): Promise<GoogleUserInfo> => {
  try {
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = require('googleapis').google.oauth2('v2');
    const { data } = await oauth2.userinfo.get({ auth: oauth2Client });

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
      verified_email: data.verified_email,
    };
  } catch (error) {
    logger.error('Error getting Google user info:', error);
    throw new Error('Failed to get Google user information');
  }
};

// Exchange authorization code for tokens
export const exchangeCodeForTokens = async (code: string) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
      idToken: tokens.id_token,
    };
  } catch (error) {
    logger.error('Error exchanging code for tokens:', error);
    throw new Error('Failed to exchange authorization code for tokens');
  }
};

// Refresh access token
export const refreshAccessToken = async (refreshToken: string) => {
  try {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();

    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date,
      idToken: credentials.id_token,
    };
  } catch (error) {
    logger.error('Error refreshing access token:', error);
    throw new Error('Failed to refresh access token');
  }
};

// Google auth service object
export const googleAuthService = {
  getGoogleAuthUrl,
  verifyGoogleToken,
  getGoogleUserInfo,
  exchangeCodeForTokens,
  refreshAccessToken,
  oauth2Client, // Export for advanced usage
};

