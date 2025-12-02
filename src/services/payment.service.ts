// Payment service - Razorpay integration
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { envConfig } from '../config/env';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

interface PaymentOrderOptions {
  amount: number; // Amount in paisa (100 = ₹1)
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

interface PaymentVerificationData {
  orderId: string;
  paymentId: string;
  signature: string;
}

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: envConfig.RAZORPAY_KEY_ID,
  key_secret: envConfig.RAZORPAY_KEY_SECRET,
});

// Create payment order
export const createPaymentOrder = async (options: PaymentOrderOptions) => {
  try {
    const orderOptions = {
      amount: options.amount,
      currency: options.currency || 'INR',
      receipt: options.receipt,
      notes: options.notes || {},
    };

    const order = await razorpay.orders.create(orderOptions);

    getLogger().info('Payment order created:', {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });

    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      createdAt: order.created_at,
    };
  } catch (error) {
    getLogger().error('Error creating payment order:', error);
    throw new Error('Failed to create payment order');
  }
};

// Verify payment signature
export const verifyPaymentSignature = (data: PaymentVerificationData): boolean => {
  try {
    const { orderId, paymentId, signature } = data;
    if (!envConfig.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay key secret is not configured');
    }
    const sign = orderId + '|' + paymentId;
    const expectedSign = crypto
      .createHmac('sha256', envConfig.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');

    return expectedSign === signature;
  } catch (error) {
    getLogger().error('Error verifying payment signature:', error);
    return false;
  }
};

// Get payment details
export const getPaymentDetails = async (paymentId: string) => {
  try {
    const payment = await razorpay.payments.fetch(paymentId);

    return {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      orderId: payment.order_id,
      captured: payment.captured,
      description: payment.description,
      email: payment.email,
      contact: payment.contact,
      createdAt: payment.created_at,
    };
  } catch (error) {
    getLogger().error('Error fetching payment details:', error);
    throw new Error('Failed to fetch payment details');
  }
};

// Capture payment (for manual capture if required)
export const capturePayment = async (paymentId: string, amount: number, currency: string = 'INR') => {
  try {
    const capture = await razorpay.payments.capture(paymentId, amount, currency);

    getLogger().info('Payment captured:', {
      paymentId,
      amount,
      status: capture.status,
    });

    return capture;
  } catch (error) {
    getLogger().error('Error capturing payment:', error);
    throw new Error('Failed to capture payment');
  }
};

// Refund payment
export const refundPayment = async (paymentId: string, options: {
  amount?: number;
  notes?: Record<string, string>;
} = {}) => {
  try {
    const refundOptions = {
      payment_id: paymentId,
      amount: options.amount,
      notes: options.notes || {},
    };

    const refund = await razorpay.payments.refund(paymentId, refundOptions);

    getLogger().info('Payment refunded:', {
      paymentId,
      refundId: refund.id,
      amount: refund.amount,
    });

    return {
      id: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      createdAt: refund.created_at,
    };
  } catch (error) {
    getLogger().error('Error refunding payment:', error);
    throw new Error('Failed to refund payment');
  }
};

// Get refund details
export const getRefundDetails = async (refundId: string) => {
  try {
    const refund = await razorpay.refunds.fetch(refundId);

    return {
      id: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      createdAt: refund.created_at,
    };
  } catch (error) {
    getLogger().error('Error fetching refund details:', error);
    throw new Error('Failed to fetch refund details');
  }
};

// Convert amount to paisa
export const toPaisa = (amount: number): number => {
  return Math.round(amount * 100);
};

// Convert paisa to rupees
export const fromPaisa = (paisa: number): number => {
  return paisa / 100;
};

// Payment service object
export const paymentService = {
  createPaymentOrder,
  verifyPaymentSignature,
  getPaymentDetails,
  capturePayment,
  refundPayment,
  getRefundDetails,
  toPaisa,
  fromPaisa,
  razorpay, // Export razorpay instance for advanced usage
};

