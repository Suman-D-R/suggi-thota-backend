// OTP storage service - In-memory cache for OTPs
// In production, consider using Redis for distributed systems
import { generateOTPData, verifyOTP as verifyOTPUtil, OTPData } from '../utils/otpGenerator';
import { logger } from '../utils/logger';

interface StoredOTP extends OTPData {
  phoneNumber: string;
  createdAt: Date;
  sessionInfo?: string; // For Firebase OTP
  isFirebaseOTP?: boolean; // Flag to indicate Firebase OTP
  verificationId?: string; // For MessageCentral OTP
  isMessageCentralOTP?: boolean; // Flag to indicate MessageCentral OTP
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
  // Clear any existing OTP for this phone number first
  // This ensures that when user requests a new OTP, the old one is invalidated
  const hadExistingOTP = otpStore.has(phoneNumber);
  if (hadExistingOTP) {
    logger.info(`Clearing existing OTP for ${phoneNumber} before generating new one`);
    otpStore.delete(phoneNumber);
  }
  
  const otpData = generateOTPData();
  const storedOTP: StoredOTP = {
    ...otpData,
    phoneNumber,
    createdAt: new Date(),
    isFirebaseOTP: false,
  };
  
  // Store OTP (overwrite if exists)
  otpStore.set(phoneNumber, storedOTP);
  
  logger.info(`OTP generated for ${phoneNumber}, expires at ${storedOTP.expiresAt}, hadExistingOTP: ${hadExistingOTP}`);
  
  return otpData.otp;
};

// Store Firebase sessionInfo for OTP verification
export const storeFirebaseSession = (phoneNumber: string, sessionInfo: string): void => {
  // Clear any existing OTP for this phone number first
  // This ensures that when user requests a new OTP, the old one is invalidated
  const hadExistingSession = otpStore.has(phoneNumber);
  if (hadExistingSession) {
    logger.info(`Clearing existing Firebase session for ${phoneNumber} before storing new one`);
    otpStore.delete(phoneNumber);
  }
  
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
  logger.info(`Firebase session stored for ${phoneNumber}, expires at ${storedOTP.expiresAt}, hadExistingSession: ${hadExistingSession}`);
};

// Store MessageCentral verificationId for OTP verification
export const storeMessageCentralVerification = (phoneNumber: string, verificationId: string): void => {
  // Clear any existing OTP for this phone number first
  const hadExistingVerification = otpStore.has(phoneNumber);
  if (hadExistingVerification) {
    logger.info(`Clearing existing MessageCentral verification for ${phoneNumber} before storing new one`);
    otpStore.delete(phoneNumber);
  }
  
  const storedOTP: StoredOTP = {
    otp: '', // No OTP stored, MessageCentral generates it
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    attempts: 0,
    phoneNumber,
    createdAt: new Date(),
    verificationId,
    isMessageCentralOTP: true,
  };
  
  otpStore.set(phoneNumber, storedOTP);
  logger.info(`MessageCentral verification stored for ${phoneNumber}, expires at ${storedOTP.expiresAt}, verificationId: ${verificationId}`);
};

// Get stored OTP for a phone number
export const getStoredOTP = (phoneNumber: string): StoredOTP | null => {
  const stored = otpStore.get(phoneNumber);
  if (!stored) {
    logger.debug(`No OTP stored for ${phoneNumber}`);
    return null;
  }
  
  // Check if expired
  const now = new Date();
  if (now > stored.expiresAt) {
    logger.info(`OTP expired for ${phoneNumber}. Created at: ${stored.createdAt}, Expires at: ${stored.expiresAt}, Now: ${now}`);
    otpStore.delete(phoneNumber);
    return null;
  }
  
  logger.debug(`OTP found for ${phoneNumber}, expires at: ${stored.expiresAt}, attempts: ${stored.attempts}`);
  return stored;
};

// Verify OTP for a phone number
export const verifyStoredOTP = (phoneNumber: string, inputOTP: string): {
  isValid: boolean;
  isExpired: boolean;
  maxAttemptsReached: boolean;
  notFound: boolean; // New field to indicate OTP doesn't exist
} => {
  const stored = getStoredOTP(phoneNumber);
  
  if (!stored) {
    // Check if there was an OTP that expired or was never created
    // We'll distinguish this in the controller
    return { isValid: false, isExpired: false, maxAttemptsReached: false, notFound: true };
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
  
  return { ...result, notFound: false };
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
  storeMessageCentralVerification,
  getStoredOTP,
  verifyStoredOTP,
  deleteOTP,
  getOTPCount,
  clearAllOTPs,
};

