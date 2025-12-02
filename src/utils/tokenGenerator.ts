// Token generator utility - Re-exports JWT utilities
import { generateTokens, generateAccessToken, generateRefreshToken } from './jwt';

// Re-export JWT token functions for backward compatibility
export const tokenGenerator = {
  generateTokens,
  generateAccessToken,
  generateRefreshToken,
};

