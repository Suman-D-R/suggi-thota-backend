// Store model
import mongoose, { Schema, Document } from 'mongoose';

export interface IStore extends Document {
  name: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  serviceRadiusKm: number;
  isActive: boolean;
}

const storeSchema = new Schema<IStore>(
  {
    name: { type: String, required: true },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
      },
      coordinates: {
        type: [Number], // longitude, latitude
        required: true,
      },
    },

    serviceRadiusKm: {
      type: Number,
      default: 5,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// 🔥 Geo index (mandatory)
// Note: This index definition tells Mongoose to create the index,
// but it may not be created if the collection already exists.
// Run `npm run create-store-index` to ensure the index exists.
storeSchema.index({ location: '2dsphere' });

export const Store = mongoose.model<IStore>('Store', storeSchema);
export default Store;

