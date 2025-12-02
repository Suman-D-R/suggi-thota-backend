// Authentication controller - Login, register, Firebase Phone Auth
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/user.model';
import { jwtUtils } from '../utils/jwt';
import { initializeFirebase } from '../config/firebase';
import { responseUtils } from '../utils/response';
import { notificationService } from '../services/notification.service';
import * as admin from 'firebase-admin';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};
import { AUTH_METHODS } from '../constants/authTypes';
import { USER_ROLES } from '../constants/roles';
import { otpService } from '../services/otp.service';
import { smsService } from '../services/sms.service';
import { firebaseOTPService } from '../services/firebase-otp.service';
import { envConfig } from '../config/env';

// Verify Firebase ID token and login/register (for Google login)
export const verifyFirebaseToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken, phone, email, name } = req.body;

    if (!idToken) {
      responseUtils.badRequestResponse(res, 'Firebase ID token is required');
      return;
    }

    // Initialize Firebase if not already initialized
    const firebaseApp = initializeFirebase();
    if (!firebaseApp) {
      responseUtils.internalServerErrorResponse(res, 'Firebase not configured');
      return;
    }

    // Verify the Firebase ID token
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await admin.auth(firebaseApp).verifyIdToken(idToken);
    } catch (error: any) {
      getLogger().error('Firebase token verification error:', error);
      responseUtils.unauthorizedResponse(res, 'Invalid or expired Firebase token');
      return;
    }

    // Extract user information from token
    const firebasePhone = decodedToken.phone_number;
    const firebaseEmail = decodedToken.email;
    const firebaseName = decodedToken.name || (decodedToken as any).display_name;
    const firebaseGoogleId = decodedToken.uid;
    
    // Use provided values or from token
    const userPhone = phone || firebasePhone;
    const userEmail = email || firebaseEmail;
    const userName = name || firebaseName;

    if (!userPhone && !userEmail) {
      responseUtils.badRequestResponse(res, 'Phone or email is required');
      return;
    }

    // Find or create user
    let user;
    if (userPhone) {
      user = await User.findByPhone(userPhone);
    } else if (userEmail) {
      user = await User.findByEmail(userEmail);
    }

    // Also check by Google ID if available
    if (!user && firebaseGoogleId) {
      user = await User.findByGoogleId(firebaseGoogleId);
    }

    const isNewUser = !user;

    if (isNewUser) {
      // For Google login, name should be available from token, but if not, require it
      if (!userName || userName.trim().length === 0) {
        responseUtils.badRequestResponse(
          res,
          'Name is required for new users. Please provide your name.',
          { requiresName: true }
        );
        return;
      }

      // Create new user with Google authentication
      user = new User({
        phone: userPhone,
        email: userEmail?.toLowerCase(),
        name: userName.trim(),
        authMethod: AUTH_METHODS.GOOGLE,
        googleId: firebaseGoogleId,
        isVerified: true,
        role: USER_ROLES.USER,
      });
    } else {
      // Update existing user
      if (user) {
        user.isVerified = true;
        user.lastLoginAt = new Date();
        user.authMethod = AUTH_METHODS.GOOGLE;
        
        // Update phone/email if provided and different
        if (userPhone && !user.phone) {
          user.phone = userPhone;
        }
        if (userEmail && !user.email) {
          user.email = userEmail.toLowerCase();
        }
        // Update Google ID if not set
        if (firebaseGoogleId && !user.googleId) {
          user.googleId = firebaseGoogleId;
        }
        // Update name if provided and different
        if (userName && userName.trim().length > 0 && userName.trim() !== user.name) {
          user.name = userName.trim();
        }
      }
    }

    if (!user) {
      responseUtils.internalServerErrorResponse(res, 'Failed to create or update user');
      return;
    }

    await user.save();

    // Generate tokens
    const tokens = jwtUtils.generateTokens({
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    getLogger().info(`User ${isNewUser ? 'registered' : 'logged in'} via Google: ${userEmail || userPhone}`);

    responseUtils.successResponse(
      res,
      isNewUser ? 'Registration successful' : 'Login successful',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
        tokens,
      }
    );
  } catch (error) {
    getLogger().error('Verify Firebase token error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to verify Firebase token');
  }
};

// Send OTP - Backend generates OTP and sends via SMS
export const sendOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      responseUtils.badRequestResponse(res, 'Phone number is required');
      return;
    }

    // Validate phone number format (should be in international format)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      responseUtils.badRequestResponse(res, 'Invalid phone number format. Please use international format (e.g., +919876543210)');
      return;
    }

    // Initialize Firebase Admin SDK
    const firebaseApp = initializeFirebase();
    if (!firebaseApp) {
      getLogger().warn('Firebase not initialized, falling back to custom OTP service');
    }

    let sessionInfo: string | undefined;
    let responseData: any = { 
      phoneNumber: phoneNumber.replace(/(\+\d{2})(\d+)/, '$1****$2'), // Mask phone number
      expiresIn: 10 // minutes
    };

    // Try to use Firebase to send OTP via SMS
    try {
      // Check both envConfig and process.env for the API key
      const apiKey = envConfig.FIREBASE_WEB_API_KEY || process.env.FIREBASE_WEB_API_KEY;
      
      if (apiKey) {
        getLogger().info(`Attempting to send Firebase OTP to ${phoneNumber}`);
        // Use Firebase Identity Toolkit REST API to send OTP
        sessionInfo = await firebaseOTPService.sendFirebaseOTP(phoneNumber);
        
        // Store sessionInfo for verification
        otpService.storeFirebaseSession(phoneNumber, sessionInfo);
        
        getLogger().info(`Firebase OTP sent to ${phoneNumber} via Firebase SMS`);
        
        responseUtils.successResponse(
          res,
          'OTP sent successfully to your phone number via Firebase SMS',
          responseData
        );
        return;
      } else {
        getLogger().warn('FIREBASE_WEB_API_KEY not found, falling back to custom OTP');
      }
    } catch (firebaseError: any) {
      getLogger().warn('Firebase OTP failed, falling back to custom OTP:', firebaseError.message);
      // Fall through to custom OTP service
    }

    // Fallback: Use custom OTP service if Firebase fails or not configured
    const otp = otpService.generateAndStoreOTP(phoneNumber);
    
    // Send OTP via SMS service (Twilio, AWS SNS, etc.)
    await smsService.sendOTPSMS(phoneNumber, otp, 10); // 10 minutes expiry

    getLogger().info(`OTP sent to ${phoneNumber} via SMS service`);

    // In development mode, include OTP in response for testing
    if (envConfig.NODE_ENV === 'development') {
      responseData.otp = otp; // Include OTP for testing in development
      getLogger().info(`[DEV] OTP included in response for ${phoneNumber}: ${otp}`);
    }

    responseUtils.successResponse(
      res,
      'OTP sent successfully to your phone number',
      responseData
    );
  } catch (error) {
    getLogger().error('Send OTP error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to send OTP. Please try again.');
  }
};

// Verify OTP - Backend verifies OTP code and authenticates user
export const verifyOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, otp, email, name } = req.body;

    if (!phoneNumber || !otp) {
      responseUtils.badRequestResponse(res, 'Phone number and OTP are required');
      return;
    }

    // Check if this is a Firebase OTP or custom OTP
    const storedOTP = otpService.getStoredOTP(phoneNumber);
    
    let idToken: string | undefined;
    
    // If Firebase OTP, verify using Firebase
    if (storedOTP?.isFirebaseOTP && storedOTP.sessionInfo) {
      try {
        idToken = await firebaseOTPService.verifyFirebaseOTP(phoneNumber, otp, storedOTP.sessionInfo);
        getLogger().info(`Firebase OTP verified for ${phoneNumber}`);
      } catch (firebaseError: any) {
        getLogger().error('Firebase OTP verification failed:', firebaseError);
        responseUtils.unauthorizedResponse(res, firebaseError.message || 'Invalid OTP. Please check and try again.');
        return;
      }
    } else {
      // Verify custom OTP
      const verificationResult = otpService.verifyStoredOTP(phoneNumber, otp);

      if (verificationResult.isExpired) {
        responseUtils.badRequestResponse(res, 'OTP has expired. Please request a new OTP.');
        return;
      }

      if (verificationResult.maxAttemptsReached) {
        responseUtils.badRequestResponse(res, 'Maximum OTP verification attempts reached. Please request a new OTP.');
        return;
      }

      if (!verificationResult.isValid) {
        responseUtils.unauthorizedResponse(res, 'Invalid OTP. Please check and try again.');
        return;
      }
    }

    // OTP is valid - find or create user
    let user = await User.findByPhone(phoneNumber);
    const isNewUser = !user;

    if (isNewUser) {
      // For new users, name is required
      if (!name || name.trim().length === 0) {
        // Return response indicating name is required
        responseUtils.badRequestResponse(
          res,
          'Name is required for new users. Please provide your name.',
          { requiresName: true }
        );
        return;
      }

      // Create new user with provided name
      user = new User({
        phone: phoneNumber,
        email: email?.toLowerCase(),
        name: name.trim(),
        authMethod: AUTH_METHODS.OTP,
        isVerified: true,
        role: USER_ROLES.USER,
      });
    } else {
      // Update existing user
      if (user) {
        user.isVerified = true;
        user.lastLoginAt = new Date();
        // Update email if provided and different
        if (email && !user.email) {
          user.email = email.toLowerCase();
        }
        // Update name if provided and different
        if (name && name.trim().length > 0 && name.trim() !== user.name) {
          user.name = name.trim();
        }
      }
    }

    // Ensure user is not null before proceeding
    if (!user) {
      responseUtils.internalServerErrorResponse(res, 'Failed to create or update user');
      return;
    }

    await user.save();

    // Delete OTP after successful verification
    otpService.deleteOTP(phoneNumber);

    // Generate tokens
    const tokens = jwtUtils.generateTokens({
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    getLogger().info(`User ${isNewUser ? 'registered' : 'logged in'} via OTP: ${phoneNumber}`);

    responseUtils.successResponse(
      res,
      isNewUser ? 'Registration successful' : 'Login successful',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
        tokens,
      }
    );
  } catch (error) {
    getLogger().error('Verify OTP error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to verify OTP');
  }
};

// Register with password
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phone, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email?.toLowerCase() },
        { phone },
      ],
    });

    if (existingUser) {
      responseUtils.conflictResponse(res, 'User already exists with this email or phone');
      return;
    }

    // Create new user
    const user = new User({
      name,
      email: email?.toLowerCase(),
      phone,
      password,
      authMethod: AUTH_METHODS.PASSWORD,
      role: USER_ROLES.USER,
      isVerified: true,
    });

    await user.save();

    // Send welcome notification
    await notificationService.sendWelcomeNotification({
      email: user.email,
      phone: user.phone,
      channels: ['email', 'sms'],
    });

    // Generate tokens
    const tokens = jwtUtils.generateTokens({
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    responseUtils.createdResponse(
      res,
      'Registration successful',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
        tokens,
      }
    );
  } catch (error) {
    getLogger().error('Register error:', error);
    responseUtils.internalServerErrorResponse(res, 'Registration failed');
  }
};

// Login with password
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      responseUtils.badRequestResponse(res, 'Email/phone and password are required');
      return;
    }

    let user;

    if (email) {
      user = await User.findByEmail(email);
    } else {
      user = await User.findByPhone(phone);
    }

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    if (!user.password) {
      responseUtils.badRequestResponse(res, 'Please use OTP login for this account');
      return;
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      responseUtils.badRequestResponse(res, 'Invalid password');
      return;
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Generate tokens
    const tokens = jwtUtils.generateTokens({
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    responseUtils.successResponse(
      res,
      'Login successful',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
        tokens,
      }
    );
  } catch (error) {
    getLogger().error('Login error:', error);
    responseUtils.internalServerErrorResponse(res, 'Login failed');
  }
};

// Refresh access token
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      responseUtils.badRequestResponse(res, 'Refresh token is required');
      return;
    }

    // Verify refresh token
    const decoded = jwtUtils.verifyRefreshToken(refreshToken);

    if (!decoded) {
      responseUtils.unauthorizedResponse(res, 'Invalid refresh token');
      return;
    }

    // Check if user exists
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      responseUtils.unauthorizedResponse(res, 'User not found or inactive');
      return;
    }

    // Generate new tokens
    const tokens = jwtUtils.generateTokens({
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    responseUtils.successResponse(
      res,
      'Token refreshed successfully',
      { tokens }
    );
  } catch (error) {
    getLogger().error('Refresh token error:', error);
    responseUtils.internalServerErrorResponse(res, 'Token refresh failed');
  }
};

// Logout (client-side token removal, but we can blacklist if needed)
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    // In a production app, you might want to blacklist the token
    // For now, just return success
    responseUtils.successResponse(res, 'Logged out successfully');
  } catch (error) {
    getLogger().error('Logout error:', error);
    responseUtils.internalServerErrorResponse(res, 'Logout failed');
  }
};

// Admin login with loginId and password
export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { loginId, password } = req.body;

    if (!loginId || !password) {
      responseUtils.badRequestResponse(res, 'Login ID and password are required');
      return;
    }

    // Find user by email or phone (loginId can be either)
    let user = await User.findOne({
      $or: [
        { email: loginId.toLowerCase() },
        { phone: loginId },
      ],
      isActive: true,
    });

    if (!user) {
      responseUtils.unauthorizedResponse(res, 'Invalid login credentials');
      return;
    }

    // Check if user is admin
    if (user.role !== USER_ROLES.ADMIN) {
      responseUtils.forbiddenResponse(res, 'Access denied. Admin privileges required.');
      return;
    }

    // Check if user has password
    if (!user.password) {
      responseUtils.badRequestResponse(res, 'Password not set for this account. Please contact administrator.');
      return;
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      responseUtils.unauthorizedResponse(res, 'Invalid login credentials');
      return;
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Generate tokens
    const tokens = jwtUtils.generateTokens({
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    responseUtils.successResponse(
      res,
      'Admin login successful',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
        tokens,
      }
    );
  } catch (error) {
    getLogger().error('Admin login error:', error);
    responseUtils.internalServerErrorResponse(res, 'Admin login failed');
  }
};

// Update user name (for users who logged in via OTP without providing name)
export const updateUserName = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    const userId = (req as any).user?.userId;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!name || name.trim().length === 0) {
      responseUtils.badRequestResponse(res, 'Name is required');
      return;
    }

    const user = await User.findById(userId);

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    // Update user name
    user.name = name.trim();
    await user.save();

    getLogger().info(`User name updated for user: ${userId}`);

    responseUtils.successResponse(
      res,
      'Name updated successfully',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
      }
    );
  } catch (error) {
    getLogger().error('Update user name error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update name');
  }
};

// Auth controller object
export const authController = {
  verifyFirebaseToken,
  sendOTP,
  verifyOTP,
  register,
  login,
  adminLogin,
  refreshToken,
  logout,
  updateUserName,
};

