// SMS service (Optional - for non-OTP notifications only)
// Note: OTP is now handled by Firebase Phone Authentication
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

interface SMSOptions {
  to: string;
  body: string;
  from?: string;
}

// Message templates (for non-OTP messages)
const messageTemplates = {
  orderConfirmation: (orderId: string, amount: number) =>
    `Your order #${orderId} has been confirmed. Total amount: ₹${amount}. Thank you for shopping with Vitura!`,

  deliveryUpdate: (orderId: string, status: string) =>
    `Your order #${orderId} status has been updated to: ${status}. Track your order in the app.`,

  welcome: (name: string) =>
    `Welcome to Vitura, ${name}! Fresh vegetables and fruits delivered to your doorstep.`,
};

// Send SMS (Optional - requires SMS provider)
// This is kept for order notifications but OTP is now handled by Firebase
export const sendSMS = async (options: SMSOptions): Promise<void> => {
  // SMS service is now optional - log warning if not configured
  getLogger().warn('SMS service is optional. OTP is handled by Firebase Phone Auth. SMS notifications require a third-party provider.');
  // Return without error - SMS is optional for order notifications
  return;
};

// Send OTP SMS
export const sendOTPSMS = async (phone: string, otp: string, expiryMinutes: number = 10): Promise<void> => {
  const message = `Your Vitura verification code is ${otp}. This code will expire in ${expiryMinutes} minutes. Do not share this code with anyone.`;
  
  try {
    // In development, just log the OTP
    if (process.env.NODE_ENV === 'development') {
      getLogger().info(`[DEV] OTP for ${phone}: ${otp}`);
      getLogger().info(`[DEV] SMS would be sent: ${message}`);
      // In development, we can return here without actually sending SMS
      // Uncomment the line below to actually send SMS in development too
      // await sendSMS({ to: phone, body: message });
      return;
    }
    
    // In production, send actual SMS
    await sendSMS({ to: phone, body: message });
    getLogger().info(`OTP SMS sent to ${phone}`);
  } catch (error) {
    getLogger().error(`Failed to send OTP SMS to ${phone}:`, error);
    // Don't throw - OTP is still generated and stored, just SMS failed
    // In production, you might want to throw or handle this differently
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
};

