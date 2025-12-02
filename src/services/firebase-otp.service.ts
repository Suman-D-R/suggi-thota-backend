// Firebase OTP service - Uses Firebase Identity Toolkit REST API to send OTPs
import * as admin from 'firebase-admin';
import { initializeFirebase } from '../config/firebase';
import { envConfig } from '../config/env';
import { logger } from '../utils/logger';

// Firebase Identity Toolkit REST API endpoint
const FIREBASE_IDENTITY_TOOLKIT_API = 'https://identitytoolkit.googleapis.com/v1';

interface SendOTPResponse {
  sessionInfo: string;
}

interface VerifyOTPResponse {
  idToken: string;
  refreshToken?: string;
  expiresIn?: string;
}

/**
 * Send OTP using Firebase Identity Toolkit REST API
 * Note: This requires Firebase Web API Key (not Admin SDK)
 */
export const sendFirebaseOTP = async (phoneNumber: string): Promise<string> => {
  try {
    const firebaseApp = initializeFirebase();
    if (!firebaseApp) {
      throw new Error('Firebase not initialized');
    }

    // Get Firebase Web API Key from environment
    const apiKey = process.env.FIREBASE_WEB_API_KEY || envConfig.FIREBASE_PROJECT_ID;
    
    if (!apiKey) {
      throw new Error('Firebase Web API Key is required. Set FIREBASE_WEB_API_KEY in your .env file');
    }

    // Use Firebase Identity Toolkit REST API to send verification code
    // Note: For real phone numbers, Firebase may require reCAPTCHA verification
    // However, if reCAPTCHA is configured as "invisible" in Firebase Console, 
    // it may work without explicit token for backend requests
    const url = `${FIREBASE_IDENTITY_TOOLKIT_API}/accounts:sendVerificationCode?key=${apiKey}`;
    
    const requestBody: any = {
      phoneNumber: phoneNumber,
    };
    
    // Try to send without reCAPTCHA first (works if reCAPTCHA is set to invisible/optional)
    // If this fails with reCAPTCHA error, you may need to:
    // 1. Configure reCAPTCHA as "invisible" in Firebase Console
    // 2. Or get reCAPTCHA token from client and pass it here
    // 3. Or use Firebase test phone numbers (configured in Firebase Console)
    
    // Optional: Add reCAPTCHA token if available
    if (process.env.FIREBASE_RECAPTCHA_TOKEN) {
      requestBody.recaptchaToken = process.env.FIREBASE_RECAPTCHA_TOKEN;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: { message?: string } };
      logger.error('Firebase OTP send error:', errorData);
      throw new Error(errorData.error?.message || 'Failed to send OTP via Firebase');
    }

    const data = await response.json() as SendOTPResponse;
    logger.info(`Firebase OTP session created for ${phoneNumber}`);
    
    return data.sessionInfo;
  } catch (error: any) {
    logger.error('Error sending Firebase OTP:', error);
    throw error;
  }
};

/**
 * Verify OTP using Firebase Identity Toolkit REST API
 */
export const verifyFirebaseOTP = async (
  phoneNumber: string,
  code: string,
  sessionInfo: string
): Promise<string> => {
  try {
    const apiKey = process.env.FIREBASE_WEB_API_KEY || envConfig.FIREBASE_PROJECT_ID;
    
    if (!apiKey) {
      throw new Error('Firebase Web API Key is required');
    }

    const url = `${FIREBASE_IDENTITY_TOOLKIT_API}/accounts:signInWithPhoneNumber?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: phoneNumber,
        sessionInfo: sessionInfo,
        code: code,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: { message?: string } };
      logger.error('Firebase OTP verify error:', errorData);
      throw new Error(errorData.error?.message || 'Invalid OTP');
    }

    const data = await response.json() as VerifyOTPResponse;
    logger.info(`Firebase OTP verified for ${phoneNumber}`);
    
    return data.idToken;
  } catch (error: any) {
    logger.error('Error verifying Firebase OTP:', error);
    throw error;
  }
};

// Firebase OTP service object
export const firebaseOTPService = {
  sendFirebaseOTP,
  verifyFirebaseOTP,
};

