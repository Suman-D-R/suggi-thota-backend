// User model - Include phone number + OTP fields
import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { AUTH_METHODS } from '../constants/authTypes';
import { USER_ROLES, UserRole } from '../constants/roles';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  phone?: string;
  email?: string;
  password?: string;
  name: string;
  role: UserRole;
  authMethod: string;
  googleId?: string;

  // OTP related fields
  otp?: string;
  otpExpiresAt?: Date;
  otpAttempts: number;

  // Profile fields
  profileImage?: string;
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';

  // Status fields
  isVerified: boolean;
  isActive: boolean;
  lastLoginAt?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  incrementOTPAttempts(): Promise<void>;
  resetOTPAttempts(): Promise<void>;
  generateOTP(): void;
  isOTPValid(otp: string): boolean;
  isOTPExpired(): boolean;
}

// Static methods interface
export interface IUserModel extends mongoose.Model<IUser> {
  findByPhone(phone: string): Promise<IUser | null>;
  findByEmail(email: string): Promise<IUser | null>;
  findByGoogleId(googleId: string): Promise<IUser | null>;
}

// User schema
const userSchema = new Schema<IUser>(
  {
    phone: {
      type: String,
      sparse: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      sparse: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },
    authMethod: {
      type: String,
      enum: Object.values(AUTH_METHODS),
      default: AUTH_METHODS.OTP,
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },

    // OTP fields
    otp: {
      type: String,
      select: false, // Don't include in regular queries
    },
    otpExpiresAt: {
      type: Date,
      select: false,
    },
    otpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    // Profile fields
    profileImage: {
      type: String,
    },
    dateOfBirth: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },

    // Status fields
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        const retAny = ret as any;
        delete retAny.password;
        delete retAny.otp;
        delete retAny.otpExpiresAt;
        delete retAny.otpAttempts;
        delete retAny.__v;
        return ret;
      },
    },
  }
);

// Indexes (phone, email, and googleId already have unique indexes from schema definition)
// Only add non-unique indexes here to avoid duplicates
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function (next) {
  const user = this as IUser;

  // Hash password if modified
  if (user.isModified('password') && user.password) {
    const saltRounds = 12;
    user.password = await bcrypt.hash(user.password, saltRounds);
  }

  next();
});

// Instance methods
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.incrementOTPAttempts = async function (): Promise<void> {
  this.otpAttempts += 1;
  await this.save();
};

userSchema.methods.resetOTPAttempts = async function (): Promise<void> {
  this.otpAttempts = 0;
  await this.save();
};

userSchema.methods.generateOTP = function (): void {
  // This will be handled by the OTP utility
  // Just setting the flag that OTP needs to be generated
};

userSchema.methods.isOTPValid = function (otp: string): boolean {
  return this.otp === otp && !this.isOTPExpired();
};

userSchema.methods.isOTPExpired = function (): boolean {
  return !this.otpExpiresAt || new Date() > this.otpExpiresAt;
};

// Static methods
userSchema.statics.findByPhone = function (phone: string) {
  return this.findOne({ phone, isActive: true });
};

userSchema.statics.findByEmail = function (email: string) {
  return this.findOne({ email: email.toLowerCase(), isActive: true });
};

userSchema.statics.findByGoogleId = function (googleId: string) {
  return this.findOne({ googleId, isActive: true });
};

// Virtual for full name (if needed in future)
userSchema.virtual('fullName').get(function () {
  return this.name;
});

// Export the model
export const User = mongoose.model<IUser, IUserModel>('User', userSchema);
export default User;

