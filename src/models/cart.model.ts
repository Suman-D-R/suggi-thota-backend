// Cart model
import mongoose, { Document, Schema } from 'mongoose';

export interface ICartItem {
  product: mongoose.Types.ObjectId;
  quantity: number;
  price: number; // Price at the time of adding to cart
  addedAt: Date;
}

export interface ICart extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  items: ICartItem[];
  totalItems: number;
  totalPrice: number;
  lastActivity: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Virtuals and methods
  addItem(productId: string, quantity: number, price: number): Promise<void>;
  updateItem(productId: string, quantity: number): Promise<void>;
  removeItem(productId: string): Promise<void>;
  clearCart(): Promise<void>;
  calculateTotals(): void;
  isEmpty(): boolean;
}

// Cart item sub-schema
const cartItemSchema = new Schema<ICartItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// Cart schema
const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: [cartItemSchema],
    totalItems: {
      type: Number,
      default: 0,
    },
    totalPrice: {
      type: Number,
      default: 0,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
cartSchema.index({ user: 1 }, { unique: true });
cartSchema.index({ lastActivity: -1 });
cartSchema.index({ 'items.product': 1 });

// Pre-save middleware to calculate totals
cartSchema.pre('save', function (next) {
  const cart = this as ICart;
  cart.calculateTotals();
  cart.lastActivity = new Date();
  next();
});

// Instance methods
cartSchema.methods.calculateTotals = function (): void {
  this.totalItems = this.items.reduce((sum: number, item: ICartItem) => sum + item.quantity, 0);
  this.totalPrice = this.items.reduce((sum: number, item: ICartItem) => sum + (item.price * item.quantity), 0);
};

cartSchema.methods.addItem = async function (
  productId: string,
  quantity: number,
  price: number
): Promise<void> {
  const existingItemIndex = this.items.findIndex(
    (item: ICartItem) => item.product.toString() === productId
  );

  if (existingItemIndex > -1) {
    // Update existing item
    this.items[existingItemIndex].quantity += quantity;
  } else {
    // Add new item
    this.items.push({
      product: new mongoose.Types.ObjectId(productId),
      quantity,
      price,
      addedAt: new Date(),
    });
  }

  await this.save();
};

cartSchema.methods.updateItem = async function (
  productId: string,
  quantity: number
): Promise<void> {
  const itemIndex = this.items.findIndex(
    (item: ICartItem) => item.product.toString() === productId
  );

  if (itemIndex > -1) {
    if (quantity <= 0) {
      // Remove item if quantity is 0 or negative
      this.items.splice(itemIndex, 1);
    } else {
      this.items[itemIndex].quantity = quantity;
    }
    await this.save();
  }
};

cartSchema.methods.removeItem = async function (productId: string): Promise<void> {
  this.items = this.items.filter(
    (item: ICartItem) => item.product.toString() !== productId
  );
  await this.save();
};

cartSchema.methods.clearCart = async function (): Promise<void> {
  this.items = [];
  this.totalItems = 0;
  this.totalPrice = 0;
  await this.save();
};

cartSchema.methods.isEmpty = function (): boolean {
  return this.items.length === 0;
};

// Static methods
cartSchema.statics.findUserCart = function (userId: string) {
  return this.findOne({ user: userId }).populate('items.product');
};

cartSchema.statics.getOrCreateCart = async function (userId: string): Promise<ICart> {
  let cart = await this.findOne({ user: userId });

  if (!cart) {
    cart = new this({ user: userId, items: [] });
    await cart.save();
  }

  return cart;
};

cartSchema.statics.cleanupOldCarts = function (daysOld: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  return this.deleteMany({
    lastActivity: { $lt: cutoffDate },
    items: { $size: 0 },
  });
};

// Virtual for formatted total price
cartSchema.virtual('formattedTotalPrice').get(function () {
  return `₹${this.totalPrice.toFixed(2)}`;
});

// Export the model
export const Cart = mongoose.model<ICart>('Cart', cartSchema);
export default Cart;

