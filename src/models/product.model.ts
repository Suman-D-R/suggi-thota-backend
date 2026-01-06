// Product model
import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  category: mongoose.Types.ObjectId;
  description?: string;
  images: string[];
}

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
    images: {
      type: [String],
      required: true,
    },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text' });
productSchema.index({ category: 1 });

export const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;
