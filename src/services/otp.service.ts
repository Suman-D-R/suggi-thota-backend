// OTP storage service - In-memory cache for OTPs
// In production, consider using Redis for distributed systems
import { generateOTPData, verifyOTP as verifyOTPUtil, OTPData } from '../utils/otpGenerator';
import { logger } from '../utils/logger';

interface StoredOTP extends OTPData {
  phoneNumber: string;
  createdAt: Date;
  sessionInfo?: string; // For Firebase OTP
  isFirebaseOTP?: boolean; // Flag to indicate Firebase OTP
}

// In-memory OTP storage
// Key: phoneNumber, Value: OTPData
const otpStore = new Map<string, StoredOTP>();

// Cleanup expired OTPs every 5 minutes
setInterval(() => {
  const now = new Date();
  let cleaned = 0;
  for (const [phone, otpData] of otpStore.entries()) {
    if (now > otpData.expiresAt) {
      otpStore.delete(phone);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} expired OTPs`);
  }
}, 5 * 60 * 1000); // 5 minutes

// Generate and store OTP for a phone number
export const generateAndStoreOTP = (phoneNumber: string): string => {
  const otpData = generateOTPData();
  const storedOTP: StoredOTP = {
    ...otpData,
    phoneNumber,
    createdAt: new Date(),
    isFirebaseOTP: false,
  };
  
  // Store OTP (overwrite if exists)
  otpStore.set(phoneNumber, storedOTP);
  
  logger.info(`OTP generated for ${phoneNumber}, expires at ${storedOTP.expiresAt}`);
  
  return otpData.otp;
};

// Store Firebase sessionInfo for OTP verification
export const storeFirebaseSession = (phoneNumber: string, sessionInfo: string): void => {
  const storedOTP: StoredOTP = {
    otp: '', // No OTP for Firebase, we verify via sessionInfo
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    attempts: 0,
    phoneNumber,
    createdAt: new Date(),
    sessionInfo,
    isFirebaseOTP: true,
  };
  
  otpStore.set(phoneNumber, storedOTP);
  logger.info(`Firebase session stored for ${phoneNumber}`);
};

// Get stored OTP for a phone number
export const getStoredOTP = (phoneNumber: string): StoredOTP | null => {
  const stored = otpStore.get(phoneNumber);
  if (!stored) {
    return null;
  }
  
  // Check if expired
  if (new Date() > stored.expiresAt) {
    otpStore.delete(phoneNumber);
    return null;
  }
  
  return stored;
};

// Verify OTP for a phone number
export const verifyStoredOTP = (phoneNumber: string, inputOTP: string): {
  isValid: boolean;
  isExpired: boolean;
  maxAttemptsReached: boolean;
} => {
  const stored = getStoredOTP(phoneNumber);
  
  if (!stored) {
    return { isValid: false, isExpired: true, maxAttemptsReached: false };
  }
  
  // Increment attempts
  stored.attempts += 1;
  
  // Verify OTP
  const result = verifyOTPUtil(inputOTP, stored.otp, stored.expiresAt, stored.attempts);
  
  // Update stored OTP
  otpStore.set(phoneNumber, stored);
  
  // If valid or max attempts reached, remove OTP
  if (result.isValid || result.maxAttemptsReached) {
    otpStore.delete(phoneNumber);
  }
  
  return result;
};

// Delete OTP for a phone number (after successful verification)
export const deleteOTP = (phoneNumber: string): void => {
  otpStore.delete(phoneNumber);
};

// Get OTP count (for monitoring)
export const getOTPCount = (): number => {
  return otpStore.size;
};

// Clear all OTPs (for testing/admin)
export const clearAllOTPs = (): void => {
  otpStore.clear();
  logger.info('All OTPs cleared');
};

// OTP service object
export const otpService = {
  generateAndStoreOTP,
  storeFirebaseSession,
  getStoredOTP,
  verifyStoredOTP,
  deleteOTP,
  getOTPCount,
  clearAllOTPs,
};

