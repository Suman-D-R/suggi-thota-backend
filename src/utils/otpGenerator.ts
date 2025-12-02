// OTP generation utility
import crypto from 'crypto';
import { OTP_CONFIG } from '../constants/authTypes';
import { logger } from './logger';

export interface OTPData {
  otp: string;
  expiresAt: Date;
  attempts: number;
}

// Generate a random OTP
export const generateOTP = (length: number = OTP_CONFIG.LENGTH): string => {
  try {
    const digits = '0123456789';
    let otp = '';

    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }

    return otp;
  } catch (error) {
    logger.error('Error generating OTP:', error);
    throw new Error('Failed to generate OTP');
  }
};

// Generate a secure OTP using crypto
export const generateSecureOTP = (length: number = OTP_CONFIG.LENGTH): string => {
  try {
    const bytes = crypto.randomBytes(length);
    let otp = '';

    for (let i = 0; i < length; i++) {
      otp += (bytes[i] % 10).toString();
    }

    return otp;
  } catch (error) {
    logger.error('Error generating secure OTP:', error);
    // Fallback to regular OTP generation
    return generateOTP(length);
  }
};

// Generate OTP data with expiry
export const generateOTPData = (): OTPData => {
  const otp = generateSecureOTP();
  const expiresAt = new Date(Date.now() + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000);

  return {
    otp,
    expiresAt,
    attempts: 0,
  };
};

// Verify OTP
export const verifyOTP = (
  inputOTP: string,
  storedOTP: string,
  expiresAt: Date,
  attempts: number
): { isValid: boolean; isExpired: boolean; maxAttemptsReached: boolean } => {
  const now = new Date();
  const isExpired = now > expiresAt;
  const maxAttemptsReached = attempts >= OTP_CONFIG.MAX_ATTEMPTS;

  if (isExpired) {
    return { isValid: false, isExpired: true, maxAttemptsReached };
  }

  if (maxAttemptsReached) {
    return { isValid: false, isExpired: false, maxAttemptsReached: true };
  }

  const isValid = inputOTP === storedOTP;
  return { isValid, isExpired: false, maxAttemptsReached: false };
};

// Check if OTP is expired
export const isOTPExpired = (expiresAt: Date): boolean => {
  return new Date() > expiresAt;
};

// Generate OTP hash for storage (optional security enhancement)
export const hashOTP = (otp: string): string => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

// Verify OTP hash
export const verifyOTPHash = (inputOTP: string, hashedOTP: string): boolean => {
  const inputHash = hashOTP(inputOTP);
  return crypto.timingSafeEqual(
    Buffer.from(inputHash, 'hex'),
    Buffer.from(hashedOTP, 'hex')
  );
};

// OTP utility functions object
export const otpGenerator = {
  generateOTP,
  generateSecureOTP,
  generateOTPData,
  verifyOTP,
  isOTPExpired,
  hashOTP,
  verifyOTPHash,
};

