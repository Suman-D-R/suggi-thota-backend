// Product model
import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  category: mongoose.Types.ObjectId;
  description?: string;
  images: string[];
  keywords?: string[]; // For search: synonyms, local language terms, common misspellings
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
    keywords: {
      type: [String],
      default: [],
      index: true,
    },
  },
  { timestamps: true }
);

// Text search index for name and keywords
productSchema.index({ name: 'text', keywords: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ keywords: 1 });

export const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;
