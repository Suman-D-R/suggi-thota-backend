// SMS service using MessageCentral API
import { logger } from '../utils/logger';
import { envConfig } from '../config/env';

interface SMSOptions {
  to: string;
  body: string;
  from?: string;
}

// MessageCentral API configuration
const MESSAGE_CENTRAL_VERIFICATION_API_URL = 'https://cpaas.messagecentral.com/verification/v3/send';
const MESSAGE_CENTRAL_VALIDATE_API_URL = 'https://cpaas.messagecentral.com/verification/v3/validateOtp';

// MessageCentral API response interface
interface MessageCentralResponse {
  success?: boolean;
  status?: string;
  message?: string;
  error?: string;
  requestId?: string;
  data?: any;
}

/**
 * Format phone number for MessageCentral (remove +91 prefix for Indian numbers)
 * MessageCentral expects 10-digit Indian numbers without country code
 * Handles formats: +91XXXXXXXXXX, 91XXXXXXXXXX, XXXXXXXXXX
 */
const formatPhoneForMessageCentral = (phone: string): string => {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If starts with 91 (India country code), remove it
  if (cleaned.startsWith('91') && cleaned.length >= 12) {
    cleaned = cleaned.substring(2);
  }
  
  // Return only last 10 digits (handles any extra digits)
  return cleaned.slice(-10);
};

/**
 * Create a timeout promise that rejects after specified milliseconds
 */
const createTimeout = (ms: number): Promise<never> => {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms);
  });
};

/**
 * Send OTP using MessageCentral Verification API
 * This is specifically for OTP messages using their verification service
 */
const sendOTPViaMessageCentral = async (phone: string): Promise<string> => {
  const authKey = envConfig.MESSAGE_CENTRAL_AUTH_KEY;
  const customerId = envConfig.MESSAGE_CENTRAL_CUSTOMER_ID;
  
  if (!authKey) {
    throw new Error('MESSAGE_CENTRAL_AUTH_KEY is not configured. Please set it in your .env file');
  }

  if (!customerId) {
    throw new Error('MESSAGE_CENTRAL_CUSTOMER_ID is not configured. Please set it in your .env file');
  }

  const formattedPhone = formatPhoneForMessageCentral(phone);
  
  if (formattedPhone.length !== 10) {
    throw new Error(`Invalid phone number format. Expected 10-digit Indian number, got: ${phone}`);
  }

  // MessageCentral Verification API parameters
  const params = new URLSearchParams({
    countryCode: '91',
    customerId: customerId,
    flowType: 'SMS',
    mobileNumber: formattedPhone,
  });

  const url = `${MESSAGE_CENTRAL_VERIFICATION_API_URL}?${params.toString()}`;

  try {
    // Create a timeout of 10 seconds for the API call
    const timeoutMs = 10000;
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'authToken': authKey,
      },
    });

    const response = await Promise.race([
      fetchPromise,
      createTimeout(timeoutMs)
    ]) as Response;

    const responseData = await response.json() as any;

    if (!response.ok) {
      const errorMessage = responseData.message || responseData.error || 'Failed to send OTP';
      logger.error(`MessageCentral API error: ${JSON.stringify(responseData)}`);
      throw new Error(`MessageCentral API error: ${errorMessage}`);
    }

    // MessageCentral returns verificationId in data.verificationId when responseCode is 200
    // Check for success: responseCode: 200 or message: "SUCCESS"
    const isSuccess = responseData.responseCode === 200 || responseData.message === 'SUCCESS';
    
    if (isSuccess) {
      // Extract verificationId from response (can be in data.verificationId or directly in responseData)
      const verificationId = responseData.data?.verificationId || responseData.verificationId || responseData.verification_id;
      
      if (verificationId) {
        logger.info(`OTP sent successfully to ${formattedPhone} via MessageCentral. Verification ID: ${verificationId}`);
        return verificationId;
      } else {
        logger.error(`MessageCentral response successful but no verificationId found: ${JSON.stringify(responseData)}`);
        throw new Error('MessageCentral did not return verification ID');
      }
    } else {
      const errorMessage = responseData.message || responseData.error || 'Failed to send OTP';
      logger.error(`MessageCentral response error: ${JSON.stringify(responseData)}`);
      throw new Error(`MessageCentral API error: ${errorMessage}`);
    }
  } catch (error: any) {
    // Check if it's a timeout error
    if (error.message?.includes('timeout')) {
      logger.error(`MessageCentral API timeout for ${formattedPhone} after 10 seconds`);
      throw new Error('SMS service timeout. Please try again.');
    }
    logger.error(`Failed to send OTP via MessageCentral to ${formattedPhone}:`, error);
    throw error;
  }
};

/**
 * Validate OTP using MessageCentral Verification API
 */
export const validateOTPViaMessageCentral = async (phone: string, code: string, verificationId: string): Promise<boolean> => {
  const authKey = envConfig.MESSAGE_CENTRAL_AUTH_KEY;
  const customerId = envConfig.MESSAGE_CENTRAL_CUSTOMER_ID;
  
  if (!authKey || !customerId) {
    throw new Error('MessageCentral credentials not configured');
  }

  const formattedPhone = formatPhoneForMessageCentral(phone);
  
  // MessageCentral Validate OTP API parameters
  const params = new URLSearchParams({
    countryCode: '91',
    mobileNumber: formattedPhone,
    verificationId: verificationId,
    customerId: customerId,
    code: code,
  });

  const url = `${MESSAGE_CENTRAL_VALIDATE_API_URL}?${params.toString()}`;

  try {
    const timeoutMs = 10000;
    const fetchPromise = fetch(url, {
      method: 'GET',
      headers: {
        'authToken': authKey,
      },
    });

    const response = await Promise.race([
      fetchPromise,
      createTimeout(timeoutMs)
    ]) as Response;

    const responseData = await response.json() as any;

    if (!response.ok) {
      logger.error(`MessageCentral validation error: ${JSON.stringify(responseData)}`);
      return false;
    }

    // Check if validation was successful
    // MessageCentral returns responseCode: 200 and message: "SUCCESS" for valid OTP
    const isValid = responseData.responseCode === 200 || 
                    responseData.message === 'SUCCESS' ||
                    responseData.valid === true || 
                    responseData.success === true || 
                    responseData.status === 'success';
    
    if (isValid) {
      logger.info(`OTP validated successfully for ${formattedPhone} via MessageCentral`);
    } else {
      logger.warn(`OTP validation failed for ${formattedPhone}: ${JSON.stringify(responseData)}`);
    }
    
    return isValid;
  } catch (error: any) {
    logger.error(`Failed to validate OTP via MessageCentral:`, error);
    return false;
  }
};

/**
 * Send SMS using MessageCentral API with timeout (for non-OTP messages)
 * Note: For OTP, use sendOTPViaMessageCentral instead
 */
const sendSMSViaMessageCentral = async (phone: string, message: string, senderId?: string): Promise<void> => {
  // For non-OTP messages, you might need to use a different endpoint
  // For now, we'll use the verification API for OTP only
  // If you need to send non-OTP SMS, you may need to use a different MessageCentral endpoint
  throw new Error('Use sendOTPViaMessageCentral for OTP messages. Non-OTP SMS sending not yet implemented for MessageCentral.');
};

// Message templates (for non-OTP messages)
const messageTemplates = {
  orderConfirmation: (orderId: string, amount: number) =>
    `Your order #${orderId} has been confirmed. Total amount: ₹${amount}. Thank you for shopping with Vitura!`,

  deliveryUpdate: (orderId: string, status: string) =>
    `Your order #${orderId} status has been updated to: ${status}. Track your order in the app.`,

  welcome: (name: string) =>
    `Welcome to Vitura, ${name}! Fresh vegetables and fruits delivered to your doorstep.`,
};

// Send SMS using MessageCentral
export const sendSMS = async (options: SMSOptions): Promise<void> => {
  // Check if MessageCentral is configured
  if (!envConfig.MESSAGE_CENTRAL_AUTH_KEY) {
    logger.warn('MESSAGE_CENTRAL_AUTH_KEY not configured. SMS will not be sent.');
    // In development, just log the message
    if (envConfig.NODE_ENV === 'development') {
      logger.info(`[DEV] SMS would be sent to ${options.to}: ${options.body}`);
      return;
    }
    throw new Error('SMS service is not configured. Please set MESSAGE_CENTRAL_AUTH_KEY in your .env file');
  }

  try {
    await sendSMSViaMessageCentral(options.to, options.body, options.from);
  } catch (error) {
    logger.error(`Failed to send SMS to ${options.to}:`, error);
    throw error;
  }
};

// Send OTP SMS using MessageCentral Verification API
// Note: MessageCentral generates and sends the OTP automatically
// We need to store the verificationId for later validation
export const sendOTPSMS = async (phone: string, otp: string, expiryMinutes: number = 10): Promise<string | void> => {
  try {
    // In development, log the OTP but still try to send if API key is configured
    if (envConfig.NODE_ENV === 'development') {
      logger.info(`[DEV] Requesting OTP for ${phone}`);
      logger.info(`[DEV] Note: MessageCentral will generate and send OTP automatically`);
      
      // If MessageCentral is not configured, just return (for local testing)
      if (!envConfig.MESSAGE_CENTRAL_AUTH_KEY) {
        logger.info(`[DEV] MessageCentral not configured, skipping actual OTP send`);
        logger.info(`[DEV] Generated OTP would be: ${otp}`);
        return;
      }
    }
    
    // MessageCentral generates and sends OTP automatically
    // We get back a verificationId that we need to store for validation
    const verificationId = await sendOTPViaMessageCentral(phone);
    logger.info(`OTP SMS sent to ${phone} via MessageCentral. Verification ID: ${verificationId}`);
    
    // Return verificationId so it can be stored for later validation
    return verificationId;
  } catch (error: any) {
    logger.error(`Failed to send OTP SMS to ${phone}:`, error);
    // In development, don't throw - allow testing without SMS
    if (envConfig.NODE_ENV === 'development') {
      logger.warn(`[DEV] SMS send failed but continuing (OTP is: ${otp})`);
      return;
    }
    // In production, you might want to throw or handle this differently
    // For now, we'll log the error but not throw to allow OTP verification even if SMS fails
    // This is a design decision - you can change it if you want SMS failures to be fatal
    throw error;
  }
};

// Send order confirmation SMS
export const sendOrderConfirmationSMS = async (phone: string, orderId: string, amount: number): Promise<void> => {
  const body = messageTemplates.orderConfirmation(orderId, amount);
  await sendSMS({ to: phone, body });
};

// Send delivery update SMS
export const sendDeliveryUpdateSMS = async (phone: string, orderId: string, status: string): Promise<void> => {
  const body = messageTemplates.deliveryUpdate(orderId, status);
  await sendSMS({ to: phone, body });
};

// Send welcome SMS
export const sendWelcomeSMS = async (phone: string, name: string): Promise<void> => {
  const body = messageTemplates.welcome(name);
  await sendSMS({ to: phone, body });
};

// Send custom SMS
export const sendCustomSMS = async (phone: string, message: string): Promise<void> => {
  await sendSMS({ to: phone, body: message });
};

// SMS service object
export const smsService = {
  sendSMS,
  sendOTPSMS,
  sendOrderConfirmationSMS,
  sendDeliveryUpdateSMS,
  sendWelcomeSMS,
  sendCustomSMS,
  validateOTPViaMessageCentral, // Export validation function
};
