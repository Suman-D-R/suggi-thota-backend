// JWT utility functions
import jwt from 'jsonwebtoken';
import { envConfig } from '../config/env';
import { logger } from './logger';

export interface JWTPayload {
  userId: string;
  email?: string;
  phone?: string;
  role: string;
  type: 'access' | 'refresh';
}

export interface AccessTokenPayload extends Omit<JWTPayload, 'type'> {
  type: 'access';
}

export interface RefreshTokenPayload extends Omit<JWTPayload, 'type'> {
  type: 'refresh';
}

// Generate access token
export const generateAccessToken = (payload: Omit<JWTPayload, 'type'>): string => {
  try {
    const accessTokenPayload: AccessTokenPayload = {
      ...payload,
      type: 'access',
    };

    return jwt.sign(accessTokenPayload, envConfig.JWT_SECRET, {
      expiresIn: '24h', // 24 hours
      issuer: 'suggi-thota-backend',
      audience: 'suggi-thota-users',
    });
  } catch (error) {
    logger.error('Error generating access token:', error);
    throw new Error('Failed to generate access token');
  }
};

// Generate refresh token
export const generateRefreshToken = (payload: Omit<JWTPayload, 'type'>): string => {
  try {
    const refreshTokenPayload: RefreshTokenPayload = {
      ...payload,
      type: 'refresh',
    };

    return jwt.sign(refreshTokenPayload, envConfig.JWT_REFRESH_SECRET, {
      expiresIn: '7d', // 7 days
      issuer: 'suggi-thota-backend',
      audience: 'suggi-thota-users',
    });
  } catch (error) {
    logger.error('Error generating refresh token:', error);
    throw new Error('Failed to generate refresh token');
  }
};

// Generate both access and refresh tokens
export const generateTokens = (payload: Omit<JWTPayload, 'type'>) => {
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  return {
    accessToken,
    refreshToken,
  };
};

// Verify access token
export const verifyAccessToken = (token: string): AccessTokenPayload | null => {
  try {
    const decoded = jwt.verify(token, envConfig.JWT_SECRET, {
      issuer: 'suggi-thota-backend',
      audience: 'suggi-thota-users',
    }) as AccessTokenPayload;

    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.error('Error verifying access token:', error);
    return null;
  }
};

// Verify refresh token
export const verifyRefreshToken = (token: string): RefreshTokenPayload | null => {
  try {
    const decoded = jwt.verify(token, envConfig.JWT_REFRESH_SECRET, {
      issuer: 'suggi-thota-backend',
      audience: 'suggi-thota-users',
    }) as RefreshTokenPayload;

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.error('Error verifying refresh token:', error);
    return null;
  }
};

// Extract token from Authorization header
export const extractTokenFromHeader = (authHeader: string | undefined): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.substring(7); // Remove 'Bearer ' prefix
};

// JWT utility functions object
export const jwtUtils = {
  generateAccessToken,
  generateRefreshToken,
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  extractTokenFromHeader,
};

