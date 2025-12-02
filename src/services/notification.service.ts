// Notification service - Combined notifications (Email, SMS, WhatsApp, Push)
import { getMessaging, notificationTemplates } from '../config/firebase';
import { emailService } from './email.service';
import { smsService } from './sms.service';
import { whatsappService } from './whatsapp.service';
import { logger } from '../utils/logger';

interface NotificationOptions {
  userId?: string;
  email?: string;
  phone?: string;
  fcmToken?: string;
  channels?: ('email' | 'sms' | 'whatsapp' | 'push')[];
}

interface OrderNotificationData {
  orderId: string;
  customerName: string;
  amount: number;
  deliveryAddress?: string;
  estimatedDelivery?: string;
}

// Send push notification via Firebase
export const sendPushNotification = async (
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> => {
  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: data || {},
    };

    const messaging = getMessaging();
    if (!messaging) {
      throw new Error('Firebase messaging is not initialized');
    }
    const response = await messaging.send(message);

    logger.info('Push notification sent:', {
      messageId: response,
      title,
      token: fcmToken.substring(0, 10) + '...',
    });
  } catch (error) {
    logger.error('Error sending push notification:', error);
    throw new Error('Failed to send push notification');
  }
};

// Send order confirmation notification
export const sendOrderConfirmationNotification = async (
  options: NotificationOptions,
  orderData: OrderNotificationData
): Promise<void> => {
  const channels = options.channels || ['email', 'sms', 'push'];

  try {
    // Email notification
    if (channels.includes('email') && options.email) {
      await emailService.sendOrderConfirmationEmail(options.email, {
        orderNumber: orderData.orderId,
        customerName: orderData.customerName,
        items: [], // Would need to be passed in
        total: orderData.amount,
        deliveryAddress: orderData.deliveryAddress || '',
        estimatedDelivery: orderData.estimatedDelivery || '',
      });
    }

    // SMS notification
    if (channels.includes('sms') && options.phone) {
      await smsService.sendOrderConfirmationSMS(
        options.phone,
        orderData.orderId,
        orderData.amount
      );
    }

    // WhatsApp notification
    if (channels.includes('whatsapp') && options.phone) {
      await whatsappService.sendOrderConfirmationWhatsApp(
        options.phone,
        orderData.orderId,
        orderData.amount
      );
    }

    // Push notification
    if (channels.includes('push') && options.fcmToken) {
      const template = notificationTemplates.orderConfirmed;
      await sendPushNotification(
        options.fcmToken,
        template.title,
        template.body,
        { orderId: orderData.orderId, type: 'order_confirmed' }
      );
    }

    logger.info('Order confirmation notifications sent:', {
      orderId: orderData.orderId,
      channels,
      email: !!options.email,
      phone: !!options.phone,
      push: !!options.fcmToken,
    });
  } catch (error) {
    logger.error('Error sending order confirmation notifications:', error);
    // Don't throw error, just log it to avoid breaking the order flow
  }
};

// Send delivery update notification
export const sendDeliveryUpdateNotification = async (
  options: NotificationOptions,
  orderId: string,
  status: string
): Promise<void> => {
  const channels = options.channels || ['sms', 'push'];

  try {
    // SMS notification
    if (channels.includes('sms') && options.phone) {
      await smsService.sendDeliveryUpdateSMS(options.phone, orderId, status);
    }

    // WhatsApp notification
    if (channels.includes('whatsapp') && options.phone) {
      await whatsappService.sendDeliveryUpdateWhatsApp(options.phone, orderId, status);
    }

    // Push notification
    if (channels.includes('push') && options.fcmToken) {
      const template = notificationTemplates.deliveryUpdate;
      await sendPushNotification(
        options.fcmToken,
        template.title,
        template.body,
        { orderId, status, type: 'delivery_update' }
      );
    }

    logger.info('Delivery update notifications sent:', {
      orderId,
      status,
      channels,
      phone: !!options.phone,
      push: !!options.fcmToken,
    });
  } catch (error) {
    logger.error('Error sending delivery update notifications:', error);
  }
};

// Send OTP notification (Deprecated - OTP is now handled by Firebase Phone Auth)
export const sendOTPNotification = async (
  options: NotificationOptions,
  otp: string,
  expiryMinutes: number = 10
): Promise<void> => {
  logger.warn('sendOTPNotification is deprecated. OTP is now handled by Firebase Phone Authentication on the client side.');
  // Do nothing - OTP is handled client-side with Firebase
  // This function is kept for backward compatibility but should not be used
};

// Send welcome notification
export const sendWelcomeNotification = async (
  options: NotificationOptions
): Promise<void> => {
  const channels = options.channels || ['email', 'sms'];

  try {
    // Email welcome
    if (channels.includes('email') && options.email) {
      await emailService.sendWelcomeEmail(options.email, 'Valued Customer');
    }

    // SMS welcome
    if (channels.includes('sms') && options.phone) {
      await smsService.sendWelcomeSMS(options.phone, 'Valued Customer');
    }

    // WhatsApp welcome
    if (channels.includes('whatsapp') && options.phone) {
      await whatsappService.sendWelcomeWhatsApp(options.phone, 'Valued Customer');
    }

    logger.info('Welcome notifications sent:', {
      channels,
      email: !!options.email,
      phone: !!options.phone,
    });
  } catch (error) {
    logger.error('Error sending welcome notifications:', error);
  }
};

// Send custom notification
export const sendCustomNotification = async (
  options: NotificationOptions,
  title: string,
  message: string,
  data?: Record<string, string>
): Promise<void> => {
  const channels = options.channels || ['push'];

  try {
    // Email
    if (channels.includes('email') && options.email) {
      await emailService.sendEmail({
        to: options.email,
        subject: title,
        text: message,
        html: `<div><h2>${title}</h2><p>${message}</p></div>`,
      });
    }

    // SMS
    if (channels.includes('sms') && options.phone) {
      await smsService.sendCustomSMS(options.phone, `${title}: ${message}`);
    }

    // WhatsApp
    if (channels.includes('whatsapp') && options.phone) {
      await whatsappService.sendCustomWhatsAppMessage(options.phone, `*${title}*\n\n${message}`);
    }

    // Push
    if (channels.includes('push') && options.fcmToken) {
      await sendPushNotification(options.fcmToken, title, message, data);
    }

    logger.info('Custom notifications sent:', {
      title,
      channels,
      email: !!options.email,
      phone: !!options.phone,
      push: !!options.fcmToken,
    });
  } catch (error) {
    logger.error('Error sending custom notifications:', error);
  }
};

// Notification service object
export const notificationService = {
  sendPushNotification,
  sendOrderConfirmationNotification,
  sendDeliveryUpdateNotification,
  sendOTPNotification,
  sendWelcomeNotification,
  sendCustomNotification,
};

