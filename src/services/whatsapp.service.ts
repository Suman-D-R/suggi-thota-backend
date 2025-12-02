// WhatsApp service (Optional - for non-OTP notifications only)
// Note: OTP is now handled by Firebase Phone Authentication
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

interface WhatsAppOptions {
  to: string;
  body: string;
  from?: string;
}

// WhatsApp message templates (for non-OTP messages)
const whatsappTemplates = {
  orderConfirmation: (orderId: string, amount: number) =>
    `🛒 *Suggi Thota*\n\n✅ Your order *#${orderId}* has been confirmed!\n\n💰 Total amount: *₹${amount}*\n\nThank you for shopping with us!`,

  deliveryUpdate: (orderId: string, status: string) =>
    `🛒 *Suggi Thota*\n\n🚚 Your order *#${orderId}* status: *${status}*\n\nTrack your order in the app for real-time updates.`,
};

// Send WhatsApp message (Optional - requires WhatsApp provider)
// This is kept for order notifications but OTP is now handled by Firebase
export const sendWhatsAppMessage = async (options: WhatsAppOptions): Promise<void> => {
  // WhatsApp service is now optional - log warning if not configured
  getLogger().warn('WhatsApp service is optional. OTP is handled by Firebase Phone Auth. WhatsApp notifications require a third-party provider.');
  // Return without error - WhatsApp is optional for order notifications
  return;
};

// Send OTP via WhatsApp (Deprecated - OTP is now handled by Firebase)
export const sendOTPWhatsApp = async (phone: string, otp: string, expiryMinutes: number = 10): Promise<void> => {
  getLogger().warn('sendOTPWhatsApp is deprecated. OTP is now handled by Firebase Phone Authentication.');
  // Do nothing - OTP is handled client-side with Firebase
};

// Send order confirmation via WhatsApp
export const sendOrderConfirmationWhatsApp = async (phone: string, orderId: string, amount: number): Promise<void> => {
  const body = whatsappTemplates.orderConfirmation(orderId, amount);
  await sendWhatsAppMessage({ to: phone, body });
};

// Send delivery update via WhatsApp
export const sendDeliveryUpdateWhatsApp = async (phone: string, orderId: string, status: string): Promise<void> => {
  const body = whatsappTemplates.deliveryUpdate(orderId, status);
  await sendWhatsAppMessage({ to: phone, body });
};

// Send custom WhatsApp message
export const sendCustomWhatsAppMessage = async (phone: string, message: string): Promise<void> => {
  await sendWhatsAppMessage({ to: phone, body: message });
};

// Send welcome message via WhatsApp
export const sendWelcomeWhatsApp = async (phone: string, name: string): Promise<void> => {
  const body = `🛒 *Suggi Thota*\n\nWelcome ${name}! 🎉\n\nThank you for choosing Suggi Thota for your fresh vegetables and fruits delivery needs.\n\nHappy shopping! 🥕🥦🍅`;
  await sendWhatsAppMessage({ to: phone, body });
};

// WhatsApp service object
export const whatsappService = {
  sendWhatsAppMessage,
  sendOTPWhatsApp,
  sendOrderConfirmationWhatsApp,
  sendDeliveryUpdateWhatsApp,
  sendWelcomeWhatsApp,
  sendCustomWhatsAppMessage,
};

