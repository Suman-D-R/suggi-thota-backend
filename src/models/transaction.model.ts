// Transaction model
import mongoose, { Document, Schema } from 'mongoose';

export interface ITransaction extends Document {
  _id: mongoose.Types.ObjectId;
  order: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  store: mongoose.Types.ObjectId;
  
  // Transaction details
  type: 'payment' | 'refund' | 'adjustment';
  paymentMethod: 'cod' | 'online' | 'wallet';
  amount: number;
  currency: string;
  
  // Payment status
  status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  
  // Payment gateway details (for online payments)
  paymentId?: string;
  transactionId?: string;
  gateway?: string;
  gatewayResponse?: any;
  
  // COD specific fields
  collectedBy?: mongoose.Types.ObjectId; // Delivery partner or admin who collected
  collectedAt?: Date;
  collectionNotes?: string;
  
  // Refund details
  refundId?: string;
  refundReason?: string;
  refundedAt?: Date;
  refundedBy?: mongoose.Types.ObjectId;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  markAsCompleted(collectedBy?: mongoose.Types.ObjectId, notes?: string): Promise<void>;
  markAsFailed(reason?: string): Promise<void>;
}

// Transaction schema
const transactionSchema = new Schema<ITransaction>(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    store: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['payment', 'refund', 'adjustment'],
      required: true,
      default: 'payment',
    },
    paymentMethod: {
      type: String,
      enum: ['cod', 'online', 'wallet'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },
    paymentId: {
      type: String,
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    gateway: {
      type: String,
    },
    gatewayResponse: {
      type: Schema.Types.Mixed,
    },
    // COD specific
    collectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    collectedAt: {
      type: Date,
    },
    collectionNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // Refund specific
    refundId: {
      type: String,
    },
    refundReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    refundedAt: {
      type: Date,
    },
    refundedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
transactionSchema.index({ order: 1, type: 1 });
transactionSchema.index({ user: 1, status: 1 });
transactionSchema.index({ store: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ transactionId: 1 });

// Static methods
transactionSchema.statics.findByOrder = function (orderId: string) {
  return this.find({ order: orderId }).sort({ createdAt: -1 });
};

transactionSchema.statics.findByUser = function (userId: string, page: number = 1, limit: number = 10) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

transactionSchema.statics.findCompletedByOrder = function (orderId: string) {
  return this.findOne({ order: orderId, status: 'completed', type: 'payment' });
};

// Instance methods
transactionSchema.methods.markAsCompleted = async function (collectedBy?: mongoose.Types.ObjectId, notes?: string) {
  this.status = 'completed';
  if (collectedBy) {
    this.collectedBy = collectedBy;
  }
  this.collectedAt = new Date();
  if (notes) {
    this.collectionNotes = notes;
  }
  await this.save();
};

transactionSchema.methods.markAsFailed = async function (reason?: string) {
  this.status = 'failed';
  if (reason) {
    this.collectionNotes = reason;
  }
  await this.save();
};

// Export the model
export interface ITransactionModel extends mongoose.Model<ITransaction> {
  findByOrder(orderId: string): Promise<ITransaction[]>;
  findByUser(userId: string, page?: number, limit?: number): Promise<ITransaction[]>;
  findCompletedByOrder(orderId: string): Promise<ITransaction | null>;
}

export const Transaction = mongoose.model<ITransaction, ITransactionModel>('Transaction', transactionSchema);
export default Transaction;

