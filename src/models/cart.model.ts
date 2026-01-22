// Cart model
import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceSnapshot {
  sellingPrice: number;
  originalPrice?: number;
  discount: number;
  finalPrice: number;
  snapshotDate: Date;
}

export interface ICartItem {
  productId: mongoose.Types.ObjectId;
  variantSku: string;
  quantity: number;
  priceSnapshot?: IPriceSnapshot; // Price at time item was added to cart
}

export interface ICartIssue {
  productId: mongoose.Types.ObjectId;
  variantSku: string;
  reason: 'OUT_OF_STOCK' | 'QUANTITY_REDUCED';
  requestedQuantity: number;
  availableQuantity: number;
}

export interface ICart extends Document {
  userId: mongoose.Types.ObjectId;
  storeId: mongoose.Types.ObjectId;
  items: ICartItem[];
  issues: ICartIssue[];
  createdAt: Date;
  updatedAt: Date;
}

const cartSchema = new Schema<ICart>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },

    items: [
      {
        productId: { type: Schema.Types.ObjectId, ref: 'Product' },
        variantSku: String,
        quantity: Number,
        priceSnapshot: {
          sellingPrice: Number,
          originalPrice: Number,
          discount: Number,
          finalPrice: Number,
          snapshotDate: { type: Date, default: Date.now },
        },
      },
    ],

    issues: [
      {
        productId: { type: Schema.Types.ObjectId, ref: 'Product' },
        variantSku: String,
        reason: {
          type: String,
          enum: ['OUT_OF_STOCK', 'QUANTITY_REDUCED'],
        },
        requestedQuantity: Number,
        availableQuantity: Number,
      },
    ],
  },
  { timestamps: true }
);

export const Cart = mongoose.model<ICart>('Cart', cartSchema);
export default Cart;
