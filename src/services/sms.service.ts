// SMS service - Placeholder for future SMS service integration
import { logger } from '../utils/logger';

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

// Send SMS - Placeholder for future SMS service integration
export const sendSMS = async (options: SMSOptions): Promise<void> => {
  // SMS service not configured - log for development/testing
  logger.info(`[SMS] Would send SMS to ${options.to}: ${options.body}`);
  // In production, integrate an SMS service provider here
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
  sendOrderConfirmationSMS,
  sendDeliveryUpdateSMS,
  sendWelcomeSMS,
  sendCustomSMS,
};
