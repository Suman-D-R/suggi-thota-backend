// Email service
import nodemailer from 'nodemailer';
import { envConfig } from '../config/env';
import { logger } from '../utils/logger';

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: envConfig.EMAIL_HOST,
    port: envConfig.EMAIL_PORT,
    secure: envConfig.EMAIL_PORT === 465, // true for 465, false for other ports
    auth: {
      user: envConfig.EMAIL_USER,
      pass: envConfig.EMAIL_PASS,
    },
  });
};

// Send email
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: options.from || envConfig.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);

    logger.info('Email sent successfully:', {
      messageId: info.messageId,
      to: options.to,
      subject: options.subject,
    });
  } catch (error) {
    logger.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

// Send welcome email
export const sendWelcomeEmail = async (email: string, name: string): Promise<void> => {
  const subject = 'Welcome to Vitura! 🛒';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to Vitura</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🍎 Welcome to Vitura!</h1>
        </div>
        <div class="content">
          <h2>Hello ${name}!</h2>
          <p>Thank you for joining Vitura, your trusted partner for fresh vegetables and fruits delivered right to your doorstep.</p>

          <p>Here's what you can do with your account:</p>
          <ul>
            <li>🛒 Browse our wide selection of fresh produce</li>
            <li>🚚 Get fast and reliable delivery</li>
            <li>💳 Secure and easy payments</li>
            <li>⭐ Rate and review your favorite products</li>
            <li>📱 Track your orders in real-time</li>
          </ul>

          <a href="${envConfig.FRONTEND_URL}" class="button">Start Shopping Now</a>

          <p>If you have any questions, feel free to contact our support team.</p>

          <p>Happy shopping! 🥕🥦🍅</p>
        </div>
        <div class="footer">
          <p>© 2024 Vitura. All rights reserved.</p>
          <p>This email was sent to ${email}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject,
    html,
  });
};

// Send OTP email
export const sendOTPEmail = async (email: string, otp: string, expiryMinutes: number = 10): Promise<void> => {
  const subject = 'Your Vitura Verification Code';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>OTP Verification</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; text-align: center; }
        .otp-code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px; margin: 20px 0; padding: 20px; background: white; border-radius: 5px; border: 2px dashed #667eea; }
        .warning { color: #e74c3c; font-weight: bold; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 Verification Code</h1>
        </div>
        <div class="content">
          <h2>Your OTP Code</h2>
          <p>We received a request to verify your account. Here's your verification code:</p>

          <div class="otp-code">${otp}</div>

          <p>This code will expire in <strong>${expiryMinutes} minutes</strong>.</p>
          <p>If you didn't request this code, please ignore this email.</p>

          <div class="warning">
            ⚠️ Do not share this code with anyone for security reasons.
          </div>
        </div>
        <div class="footer">
          <p>© 2024 Vitura. All rights reserved.</p>
          <p>This email was sent to ${email}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject,
    html,
  });
};

// Send order confirmation email
export const sendOrderConfirmationEmail = async (
  email: string,
  orderDetails: {
    orderNumber: string;
    customerName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    total: number;
    deliveryAddress: string;
    estimatedDelivery: string;
  }
): Promise<void> => {
  const subject = `Order Confirmed: ${orderDetails.orderNumber}`;
  const itemsHtml = orderDetails.items.map(item =>
    `<tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${item.price.toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Order Confirmation</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .order-details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .total { font-size: 18px; font-weight: bold; color: #28a745; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Order Confirmed!</h1>
        </div>
        <div class="content">
          <h2>Hello ${orderDetails.customerName}!</h2>
          <p>Your order has been confirmed and is being prepared for delivery.</p>

          <div class="order-details">
            <h3>Order Details</h3>
            <p><strong>Order Number:</strong> ${orderDetails.orderNumber}</p>

            <table class="table">
              <thead>
                <tr style="background: #f8f9fa;">
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #dee2e6;">Item</th>
                  <th style="padding: 10px; text-align: center; border-bottom: 2px solid #dee2e6;">Qty</th>
                  <th style="padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
                <tr>
                  <td colspan="2" style="padding: 15px; text-align: right; font-weight: bold;">Total:</td>
                  <td style="padding: 15px; text-align: right; font-weight: bold; color: #28a745;">₹${orderDetails.total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <h4>Delivery Details</h4>
            <p><strong>Delivery Address:</strong> ${orderDetails.deliveryAddress}</p>
            <p><strong>Estimated Delivery:</strong> ${orderDetails.estimatedDelivery}</p>
          </div>

          <p>You can track your order status in the app. We'll send you updates as your order progresses.</p>

          <p>Thank you for choosing Vitura! 🥕🥦🍅</p>
        </div>
        <div class="footer">
          <p>© 2024 Vitura. All rights reserved.</p>
          <p>This email was sent to ${email}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject,
    html,
  });
};

// Send password reset email
export const sendPasswordResetEmail = async (email: string, resetToken: string): Promise<void> => {
  const resetUrl = `${envConfig.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const subject = 'Password Reset Request';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Password Reset</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; text-align: center; }
        .button { display: inline-block; background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .warning { color: #856404; background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔑 Password Reset</h1>
        </div>
        <div class="content">
          <h2>Reset Your Password</h2>
          <p>You requested a password reset for your Vitura account.</p>
          <p>Click the button below to reset your password:</p>

          <a href="${resetUrl}" class="button">Reset Password</a>

          <div class="warning">
            <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour. If you didn't request this reset, please ignore this email.
          </div>

          <p>If the button doesn't work, copy and paste this URL into your browser:</p>
          <p style="word-break: break-all; color: #666; font-size: 12px;">${resetUrl}</p>
        </div>
        <div class="footer">
          <p>© 2024 Vitura. All rights reserved.</p>
          <p>This email was sent to ${email}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject,
    html,
  });
};

// Email service object
export const emailService = {
  sendEmail,
  sendWelcomeEmail,
  sendOTPEmail,
  sendOrderConfirmationEmail,
  sendPasswordResetEmail,
};

