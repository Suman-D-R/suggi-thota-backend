// Firebase configuration
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import { envConfig } from './env';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

// Helper function to properly format private key
const formatPrivateKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  
  // Replace escaped newlines with actual newlines
  let formattedKey = key.replace(/\\n/g, '\n');
  
  // Ensure the key starts and ends with proper PEM markers
  if (!formattedKey.includes('-----BEGIN')) {
    return undefined;
  }
  
  // Ensure proper line breaks
  if (!formattedKey.includes('\n')) {
    // If no newlines, try to add them (this shouldn't happen if properly formatted)
    formattedKey = formattedKey.replace(/-----BEGIN/g, '-----BEGIN\n').replace(/-----END/g, '\n-----END');
  }
  
  return formattedKey;
};

// Firebase configuration object
export const firebaseConfig = {
  projectId: envConfig.FIREBASE_PROJECT_ID,
  privateKey: formatPrivateKey(envConfig.FIREBASE_PRIVATE_KEY),
  clientEmail: envConfig.FIREBASE_CLIENT_EMAIL,
};

// Initialize Firebase Admin SDK
let firebaseApp: admin.app.App | undefined;
let initializationAttempted = false;

// Initialize Firebase Admin SDK (matching user's requested format)
const initializeFirebase = (): admin.app.App | undefined => {
  if (initializationAttempted) {
    return firebaseApp;
  }
  
  initializationAttempted = true;

  try {
    // Check if Firebase is already initialized
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
      logger.info('Firebase Admin SDK already initialized');
      return firebaseApp;
    }

    // Initialize if credentials are provided
    if (envConfig.FIREBASE_PROJECT_ID && envConfig.FIREBASE_CLIENT_EMAIL && envConfig.FIREBASE_PRIVATE_KEY) {
      try {
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: envConfig.FIREBASE_PROJECT_ID,
            clientEmail: envConfig.FIREBASE_CLIENT_EMAIL,
            privateKey: envConfig.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
        });
        logger.info('Firebase Admin SDK initialized successfully');
      } catch (initError: any) {
        logger.warn('Firebase initialization error:', initError?.message || String(initError));
        firebaseApp = undefined;
      }
    } else {
      logger.info('Firebase credentials not provided. Skipping Firebase initialization.');
    }
  } catch (error: any) {
    logger.warn('Firebase initialization error (non-critical):', error?.message || String(error));
    firebaseApp = undefined;
  }
  
  return firebaseApp;
};

export { firebaseApp, initializeFirebase };

// Default export for admin (matching user's requested format)
export default admin;

// Firebase services (lazy getters - only initialize when accessed)
export const getMessaging = () => {
  const app = initializeFirebase();
  return app ? admin.messaging(app) : null;
};

export const getFirestore = () => {
  const app = initializeFirebase();
  return app ? admin.firestore(app) : null;
};

// Notification templates
export const notificationTemplates = {
  orderConfirmed: {
    title: 'Order Confirmed! 🎉',
    body: 'Your order has been confirmed and is being prepared.',
  },

  orderReady: {
    title: 'Order Ready for Delivery 🚚',
    body: 'Your order is ready and will be delivered soon.',
  },

  orderDelivered: {
    title: 'Order Delivered! ✅',
    body: 'Your order has been delivered successfully.',
  },

  orderCancelled: {
    title: 'Order Cancelled',
    body: 'Your order has been cancelled. Please contact support for details.',
  },

  otpVerification: {
    title: 'Verification Code',
    body: 'Your verification code is ready. Check your SMS.',
  },

  paymentSuccess: {
    title: 'Payment Successful 💳',
    body: 'Your payment has been processed successfully.',
  },

  deliveryUpdate: {
    title: 'Delivery Update 🚚',
    body: 'Your order status has been updated.',
  },
};

