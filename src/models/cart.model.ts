// Cart model
import mongoose, { Document, Schema } from 'mongoose';

export interface ICartVariant {
  size: number;
  unit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen';
  quantity: number;
  price: number; // Price at the time of adding to cart
}

export interface ICartItem {
  product: mongoose.Types.ObjectId;
  variants: ICartVariant[]; // Array of variants with size, unit, quantity, and price
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
  addItem(productId: string, size: number, unit: string, quantity: number, price: number): Promise<void>;
  updateItem(productId: string, size: number, unit: string, quantity: number): Promise<void>;
  removeItem(productId: string, size?: number, unit?: string): Promise<void>;
  removeVariant(productId: string, size: number, unit: string): Promise<void>;
  clearCart(): Promise<void>;
  calculateTotals(): void;
  isEmpty(): boolean;
  findItemIndex(productId: string): number;
  findVariantIndex(productId: string, size: number, unit: string): { itemIndex: number; variantIndex: number } | null;
}

// Static methods interface
export interface ICartModel extends mongoose.Model<ICart> {
  findUserCart(userId: string): Promise<ICart | null>;
  getOrCreateCart(userId: string): Promise<ICart>;
  cleanupOldCarts(daysOld?: number): Promise<any>;
}

// Cart variant sub-schema
const cartVariantSchema = new Schema<ICartVariant>(
  {
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
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
  },
  { _id: false }
);

// Cart item sub-schema
const cartItemSchema = new Schema<ICartItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    variants: {
      type: [cartVariantSchema],
      required: true,
      validate: {
        validator: function(value: ICartVariant[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'At least one variant is required',
      },
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
cartSchema.index({ 'items.variants.size': 1, 'items.variants.unit': 1 });

// Pre-save middleware to calculate totals
cartSchema.pre('save', function (next) {
  const cart = this as ICart;
  cart.calculateTotals();
  cart.lastActivity = new Date();
  next();
});

// Instance methods
cartSchema.methods.calculateTotals = function (): void {
  this.totalItems = this.items.reduce((sum: number, item: ICartItem) => {
    return sum + item.variants.reduce((itemSum: number, variant: ICartVariant) => itemSum + variant.quantity, 0);
  }, 0);
  
  this.totalPrice = this.items.reduce((sum: number, item: ICartItem) => {
    return sum + item.variants.reduce((itemSum: number, variant: ICartVariant) => {
      return itemSum + (variant.price * variant.quantity);
    }, 0);
  }, 0);
};

// Helper method to find item index by product
cartSchema.methods.findItemIndex = function (productId: string): number {
  return this.items.findIndex((item: ICartItem) => {
    // Handle both populated (object with _id) and unpopulated (ObjectId) product
    if (typeof item.product === 'object' && item.product !== null && (item.product as any)._id) {
      // Product is populated (object)
      return (item.product as any)._id.toString() === productId;
    } else {
      // Product is ObjectId
      return item.product.toString() === productId;
    }
  });
};

// Helper method to find variant index within a cart item
cartSchema.methods.findVariantIndex = function (
  productId: string,
  size: number,
  unit: string
): { itemIndex: number; variantIndex: number } | null {
  const itemIndex = this.findItemIndex(productId);
  
  if (itemIndex === -1) {
    return null;
  }
  
  // Ensure size is a number for comparison
  const sizeNum = typeof size === 'string' ? parseFloat(size) : Number(size);
  
  const variantIndex = this.items[itemIndex].variants.findIndex(
    (variant: ICartVariant) => Number(variant.size) === sizeNum && String(variant.unit).toLowerCase() === String(unit).toLowerCase()
  );
  
  if (variantIndex === -1) {
    return null;
  }
  
  return { itemIndex, variantIndex };
};

cartSchema.methods.addItem = async function (
  productId: string,
  size: number,
  unit: string,
  quantity: number,
  price: number
): Promise<void> {
  // Ensure size is a number
  const sizeNum = typeof size === 'string' ? parseFloat(size) : Number(size);
  const quantityNum = typeof quantity === 'string' ? parseInt(quantity, 10) : Number(quantity);
  const priceNum = typeof price === 'string' ? parseFloat(price) : Number(price);
  
  const itemIndex = this.findItemIndex(productId);
  
  if (itemIndex > -1) {
    // Product already in cart, check if variant exists
    const variantIndex = this.items[itemIndex].variants.findIndex(
      (variant: ICartVariant) => Number(variant.size) === sizeNum && String(variant.unit).toLowerCase() === String(unit).toLowerCase()
    );
    
    if (variantIndex > -1) {
      // Variant exists, increment quantity and update price
      this.items[itemIndex].variants[variantIndex].quantity += quantityNum;
      this.items[itemIndex].variants[variantIndex].price = priceNum; // Update to latest price
    } else {
      // Variant doesn't exist, add new variant
      this.items[itemIndex].variants.push({
        size: sizeNum,
        unit: unit as 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen',
        quantity: quantityNum,
        price: priceNum,
      });
    }
  } else {
    // Product not in cart, create new item with variant
    const newItem: ICartItem = {
      product: new mongoose.Types.ObjectId(productId),
      variants: [
        {
          size: sizeNum,
          unit: unit as 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen',
          quantity: quantityNum,
          price: priceNum,
        },
      ],
      addedAt: new Date(),
    };
    
    this.items.push(newItem);
  }

  await this.save();
};

cartSchema.methods.updateItem = async function (
  productId: string,
  size: number,
  unit: string,
  quantity: number
): Promise<void> {
  // Ensure size is a number
  const sizeNum = typeof size === 'string' ? parseFloat(size) : Number(size);
  const quantityNum = typeof quantity === 'string' ? parseInt(quantity, 10) : Number(quantity);
  
  // Debug: Log cart state before finding variant
  console.log('updateItem - Looking for variant:', {
    productId,
    size: sizeNum,
    unit,
    quantity: quantityNum,
    itemsCount: this.items.length,
    items: this.items.map((item: any) => ({
      productId: item.product.toString(),
      productIdObj: (item.product as any)._id ? (item.product as any)._id.toString() : null,
      variants: item.variants.map((v: any) => ({ size: v.size, unit: v.unit, quantity: v.quantity }))
    }))
  });
  
  const variantLocation = this.findVariantIndex(productId, sizeNum, unit);
  
  if (!variantLocation) {
    // Debug: Log why variant wasn't found
    const itemIndex = this.findItemIndex(productId);
    console.log('updateItem - Variant not found:', {
      productId,
      size: sizeNum,
      unit,
      itemIndex,
      itemFound: itemIndex !== -1,
      itemVariants: itemIndex !== -1 ? this.items[itemIndex].variants.map((v: any) => ({
        size: v.size,
        sizeType: typeof v.size,
        unit: v.unit,
        unitType: typeof v.unit
      })) : []
    });
    throw new Error(`Variant not found: productId=${productId}, size=${sizeNum}, unit=${unit}`);
  }
  
  const { itemIndex, variantIndex } = variantLocation;
  
  if (quantityNum <= 0) {
    // Remove variant if quantity is 0 or negative
    this.items[itemIndex].variants.splice(variantIndex, 1);
    
    // If no variants left, remove the entire item
    if (this.items[itemIndex].variants.length === 0) {
      this.items.splice(itemIndex, 1);
    }
  } else {
    // Update quantity
    this.items[itemIndex].variants[variantIndex].quantity = quantityNum;
  }
  
  // Calculate totals will be called by pre-save hook
  await this.save();
};

cartSchema.methods.removeVariant = async function (
  productId: string,
  size: number,
  unit: string
): Promise<void> {
  const variantLocation = this.findVariantIndex(productId, size, unit);
  
  if (variantLocation) {
    const { itemIndex, variantIndex } = variantLocation;
    
    // Remove the variant
    this.items[itemIndex].variants.splice(variantIndex, 1);
    
    // If no variants left, remove the entire item
    if (this.items[itemIndex].variants.length === 0) {
      this.items.splice(itemIndex, 1);
    }
    
    await this.save();
  }
};

cartSchema.methods.removeItem = async function (
  productId: string,
  size?: number,
  unit?: string
): Promise<void> {
  const itemIndex = this.findItemIndex(productId);
  
  if (itemIndex > -1) {
    if (size !== undefined && unit !== undefined) {
      // Remove specific variant
      await this.removeVariant(productId, size, unit);
    } else {
      // Remove entire item (all variants)
      this.items.splice(itemIndex, 1);
      await this.save();
    }
  }
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
cartSchema.statics.findUserCart = async function (userId: string): Promise<ICart | null> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  return await this.findOne({ user: userObjectId }).populate('items.product').exec();
};

cartSchema.statics.getOrCreateCart = async function (userId: string): Promise<ICart> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let cart = await this.findOne({ user: userObjectId });

  if (!cart) {
    cart = new this({ user: userObjectId, items: [] });
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
export const Cart = mongoose.model<ICart, ICartModel>('Cart', cartSchema);
export default Cart;

