// InventoryBatch model
import mongoose, { Schema, Document } from 'mongoose';

export type BatchStatus = 'active' | 'expired' | 'depleted' | 'cancelled';

export interface IInventoryBatch extends Document {
  storeId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  
  // Variant SKU - required for variant-specific stock (e.g., rice packages)
  // Optional for shared stock products (e.g., vegetables sold by weight)
  variantSku?: string;

  // Stock management
  initialQuantity: number; // Original quantity when batch was created
  availableQuantity: number; // Current available quantity (decreases with orders)
  soldQuantity: number; // Quantity sold (increases with orders) - useful for reporting
  costPrice: number; // Cost price per unit

  // Stock type: variant-specific (false) or shared stock (true)
  // Variant-specific: Each variant has separate batches (e.g., rice 1kg, 5kg bags)
  // Shared stock: One batch serves all variants, stock shared across variants (e.g., vegetables)
  usesSharedStock: boolean;
  
  // For shared stock: base unit for quantity tracking (e.g., 'kg', 'g')
  baseUnit?: 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack';

  // Batch metadata for store owners
  batchNumber?: string; // Batch/GRN number for tracking
  supplier?: string; // Supplier name
  purchaseDate?: Date; // Date of purchase
  expiryDate?: Date; // Expiry date (if applicable)
  notes?: string; // Additional notes/comments

  // Status tracking
  status: BatchStatus; // active, expired, depleted, cancelled

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Virtuals (computed properties)
  isExpired: boolean;
  isAvailable: boolean;

  // Methods
  hasSufficientQuantity(quantity: number): boolean;
}

// Static methods interface
export interface IInventoryBatchModel extends mongoose.Model<IInventoryBatch> {
  deductStock(
    batchId: string | mongoose.Types.ObjectId,
    quantity: number,
    session?: mongoose.ClientSession | null
  ): Promise<IInventoryBatch>;
}

const inventoryBatchSchema = new Schema<IInventoryBatch>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    variantSku: {
      type: String,
      required: function(this: IInventoryBatch) {
        return !this.usesSharedStock;
      },
    },

    initialQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    availableQuantity: {
      type: Number,
      required: true,
      min: 0,
      default: function(this: IInventoryBatch) {
        return this.initialQuantity;
      },
    },

    soldQuantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    costPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    usesSharedStock: {
      type: Boolean,
      default: false,
    },

    baseUnit: {
      type: String,
      enum: ['kg', 'g', 'ml', 'liter', 'piece', 'pack'],
      required: function(this: IInventoryBatch) {
        return this.usesSharedStock === true;
      },
    },

    batchNumber: {
      type: String,
      trim: true,
    },

    supplier: {
      type: String,
      trim: true,
    },

    purchaseDate: {
      type: Date,
      default: Date.now,
    },

    expiryDate: {
      type: Date,
    },

    notes: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: ['active', 'expired', 'depleted', 'cancelled'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
inventoryBatchSchema.index({ storeId: 1, productId: 1 });
inventoryBatchSchema.index({ storeId: 1, productId: 1, variantSku: 1 });
inventoryBatchSchema.index({ storeId: 1, productId: 1, status: 1 });
inventoryBatchSchema.index({ status: 1, expiryDate: 1 }); // For finding expired batches
inventoryBatchSchema.index({ batchNumber: 1 }); // For batch number lookup

// Unique index to prevent accidental duplicate batches
// Sparse: only applies when batchNumber is present
inventoryBatchSchema.index(
  { storeId: 1, productId: 1, variantSku: 1, batchNumber: 1 },
  { unique: true, sparse: true }
);

// TTL index for automatic expiry handling (optional - uncomment if needed)
// Note: This requires MongoDB TTL monitor to be running
// inventoryBatchSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });

// Virtual to check if batch is expired
inventoryBatchSchema.virtual('isExpired').get(function(this: IInventoryBatch) {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual to check if batch is available (not depleted/expired/cancelled)
inventoryBatchSchema.virtual('isAvailable').get(function(this: IInventoryBatch) {
  const isExpired = this.expiryDate && new Date() > this.expiryDate;
  return this.status === 'active' && this.availableQuantity > 0 && !isExpired;
});

// Pre-save hook to update status based on quantity and expiry
inventoryBatchSchema.pre('save', function(next) {
  // Update status to depleted if available quantity is 0
  if (this.availableQuantity <= 0 && this.status === 'active') {
    this.status = 'depleted';
  }

  // Update status to expired if expiry date has passed
  const isExpired = this.expiryDate && new Date() > this.expiryDate;
  if (isExpired && this.status === 'active') {
    this.status = 'expired';
  }

  next();
});

// Method to check if batch has sufficient quantity
inventoryBatchSchema.methods.hasSufficientQuantity = function(requiredQuantity: number): boolean {
  return this.status === 'active' && this.availableQuantity >= requiredQuantity && !this.isExpired;
};

/**
 * 📋 RECOMMENDED QUERY PATTERN FOR ACTIVE BATCHES
 * 
 * When querying for active batches, always use these filters to ensure:
 * - Only active batches are returned
 * - Expired batches are excluded
 * - Batches with available stock are prioritized
 * 
 * @example
 * ```typescript
 * const activeBatches = await InventoryBatch.find({
 *   productId,
 *   storeId,
 *   availableQuantity: { $gt: 0 },
 *   status: 'active',
 *   $or: [
 *     { expiryDate: null },
 *     { expiryDate: { $gt: new Date() } }
 *   ],
 * }).sort({ createdAt: 1 }); // FIFO order
 * ```
 * 
 * ⚠️ IMPORTANT: Always include expiry check in queries, not just in application logic.
 * This ensures expired batches are never used, even if status wasn't updated yet.
 */

/**
 * 🔒 ATOMIC & CONCURRENCY-SAFE STOCK DEDUCTION
 * 
 * This static method ensures no overselling even in high-concurrency environments.
 * It atomically checks AND deducts stock in a single MongoDB operation.
 * 
 * ⚠️ CRITICAL: This is the ONLY authoritative method for stock deduction.
 * Always use this method instead of manual findOneAndUpdate operations.
 * 
 * @param batchId - The inventory batch ID
 * @param quantity - Quantity to deduct (must be > 0)
 * @param session - Optional MongoDB session for transactions
 * @returns Updated batch document
 * @throws Error with message 'INSUFFICIENT_STOCK' if deduction fails
 * 
 * @example
 * ```typescript
 * try {
 *   const batch = await InventoryBatch.deductStock(batchId, 5);
 *   console.log(`Deducted 5 units. Remaining: ${batch.availableQuantity}`);
 * } catch (error) {
 *   if (error.message === 'INSUFFICIENT_STOCK') {
 *     // Handle insufficient stock
 *   }
 * }
 * ```
 */
inventoryBatchSchema.statics.deductStock = async function(
  batchId: string | mongoose.Types.ObjectId,
  quantity: number,
  session?: mongoose.ClientSession | null
): Promise<IInventoryBatch> {
  if (quantity <= 0) {
    throw new Error('INVALID_QUANTITY: Quantity must be greater than 0');
  }

  // 🔒 ATOMIC UPDATE: Check conditions AND update in single operation
  // This prevents race conditions where two orders read the same stock
  const queryConditions: any = {
    _id: batchId,
    status: 'active',
    availableQuantity: { $gte: quantity }, // ⚠️ KEY: Prevents negative stock
    $or: [
      { expiryDate: null },
      { expiryDate: { $gt: new Date() } }, // Not expired
    ],
  };

  const updateOperation: any = {
    $inc: {
      availableQuantity: -quantity,
      soldQuantity: quantity, // Track sold quantity for reporting
    },
  };

  const options: any = {
    new: true,
    ...(session ? { session } : {}),
  };

  const batch = await this.findOneAndUpdate(
    queryConditions,
    updateOperation,
    options
  );

  if (!batch) {
    // Fetch batch to get details for error message
    const batchInfo = await this.findById(batchId).session(session || null);
    if (!batchInfo) {
      throw new Error('INSUFFICIENT_STOCK: Inventory batch not found');
    } else if (batchInfo.status !== 'active') {
      throw new Error(`INSUFFICIENT_STOCK: Batch status is ${batchInfo.status}, expected 'active'`);
    } else if (batchInfo.expiryDate && new Date() > batchInfo.expiryDate) {
      throw new Error('INSUFFICIENT_STOCK: Batch has expired');
    } else {
      throw new Error(
        `INSUFFICIENT_STOCK: Required ${quantity}, but only ${batchInfo.availableQuantity} available`
      );
    }
  }

  // ⚠️ CRITICAL FIX: Update status to 'depleted' if quantity reaches 0
  // pre('save') hook doesn't run on findOneAndUpdate, so we must do it manually
  if (batch.availableQuantity <= 0) {
    const statusUpdateQuery = this.findByIdAndUpdate(
      batchId,
      { $set: { status: 'depleted' } },
      {
        new: true,
        ...(session ? { session } : {}),
      }
    );
    const updatedBatch = await statusUpdateQuery;
    if (updatedBatch) {
      updatedBatch.status = 'depleted';
      return updatedBatch;
    }
  }

  return batch;
};

export const InventoryBatch = mongoose.model<IInventoryBatch, IInventoryBatchModel>(
  'InventoryBatch',
  inventoryBatchSchema
);
export default InventoryBatch;

