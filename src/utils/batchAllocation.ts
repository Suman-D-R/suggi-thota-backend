// Batch allocation utilities for FIFO inventory management
// NOTE: This file is deprecated - batch allocation is now handled directly in order controller
// using InventoryBatch model. Keeping for backward compatibility.
import mongoose from 'mongoose';
import { InventoryBatch } from '../models/inventoryBatch.model';
import { IBatchSplit } from '../models/order.model';

/**
 * Allocate batches using FIFO (First In First Out) algorithm
 * @param productId - Product ID to allocate batches for
 * @param requiredQty - Quantity required
 * @param size - Optional: Size of the variant to allocate batches for
 * @param unit - Optional: Unit of the variant to allocate batches for
 * @returns Array of batch splits with quantities and prices
 */
export async function allocateBatches(
  productId: string | mongoose.Types.ObjectId,
  requiredQty: number,
  size?: number,
  unit?: string
): Promise<IBatchSplit[]> {
  // Build query filter
  const filter: any = {
    product: productId,
  };

  // NOTE: This function is deprecated - batch allocation is now handled in order controller
  // For now, returning empty array to prevent crashes
  // TODO: Remove this file or update to use InventoryBatch
  const batches: any[] = [];
  // const batches = await InventoryBatch.find(filter)
  //   .sort({ createdAt: 1 }) // Oldest first (FIFO)
  //   .lean();

  if (batches.length === 0) {
    throw new Error('No batches available for this product');
  }

  let remainingQty = requiredQty;
  const splits: IBatchSplit[] = [];

  for (const batch of batches) {
    if (remainingQty <= 0) break;

    // Find matching selling variant if size/unit provided
    let matchingVariants = batch.sellingVariants || [];
    if (size !== undefined && unit !== undefined) {
      matchingVariants = matchingVariants.filter(
        (sv: any) => sv.sellingSize === size && sv.sellingUnit === unit && sv.quantityAvailable > 0
      );
    } else {
      // Filter variants with available stock
      matchingVariants = matchingVariants.filter((sv: any) => sv.quantityAvailable > 0);
    }

    if (matchingVariants.length === 0) continue;

    // Process variants in order (FIFO)
    for (const variant of matchingVariants) {
      if (remainingQty <= 0) break;

      const availableQty = variant.quantityAvailable || 0;
      if (availableQty <= 0) continue;

      const takeQty = Math.min(availableQty, remainingQty);

      splits.push({
        batch: batch._id as mongoose.Types.ObjectId,
        quantity: takeQty,
        sellingPrice: variant.sellingPrice,
        costPrice: batch.totalCost, // Using totalCost for historical order tracking
      });

      remainingQty -= takeQty;
    }
  }

  if (remainingQty > 0) {
    // Calculate total available from all selling variants
    let totalAvailable = 0;
    for (const batch of batches) {
      if (batch.sellingVariants && Array.isArray(batch.sellingVariants)) {
        if (size !== undefined && unit !== undefined) {
          // Filter by size/unit if provided
          const matchingVariants = batch.sellingVariants.filter(
            (sv: any) => sv.sellingSize === size && sv.sellingUnit === unit
          );
          totalAvailable += matchingVariants.reduce((sum: number, sv: any) => sum + (sv.quantityAvailable || 0), 0);
        } else {
          // Sum all variants
          totalAvailable += batch.sellingVariants.reduce((sum: number, sv: any) => sum + (sv.quantityAvailable || 0), 0);
        }
      }
    }
    throw new Error(
      `Insufficient stock. Required: ${requiredQty}, Available: ${totalAvailable}`
    );
  }

  return splits;
}

/**
 * Reduce stock for batch splits (transaction-safe)
 * @param splits - Array of batch splits to reduce stock for
 * @param session - Optional MongoDB session for transaction
 */
export async function reduceBatchStock(
  splits: IBatchSplit[],
  session?: mongoose.ClientSession
): Promise<void> {
  const operations = splits.map((split) => ({
    updateOne: {
      filter: { _id: split.batch },
      update: {
        $inc: { quantityAvailable: -split.quantity },
      },
    },
  }));

  if (session) {
    // NOTE: Deprecated - batch allocation now handled in order controller
    // await InventoryBatch.bulkWrite(operations, { session });
  } else {
    // NOTE: Deprecated - batch allocation now handled in order controller
    // await InventoryBatch.bulkWrite(operations);
  }
}

/**
 * Restore stock for batch splits (for order cancellation/refund)
 * @param splits - Array of batch splits to restore stock for
 * @param session - Optional MongoDB session for transaction
 */
export async function restoreBatchStock(
  splits: IBatchSplit[],
  session?: mongoose.ClientSession
): Promise<void> {
  const operations = splits.map((split) => ({
    updateOne: {
      filter: { _id: split.batch },
      update: {
        $inc: { quantityAvailable: split.quantity },
      },
    },
  }));

  if (session) {
    // NOTE: Deprecated - batch allocation now handled in order controller
    // await InventoryBatch.bulkWrite(operations, { session });
  } else {
    // NOTE: Deprecated - batch allocation now handled in order controller
    // await InventoryBatch.bulkWrite(operations);
  }
}

/**
 * Calculate total cost from batch splits
 */
export function calculateTotalCost(splits: IBatchSplit[]): number {
  return splits.reduce(
    (sum, split) => sum + (split.costPrice * split.quantity),
    0
  );
}

/**
 * Calculate total selling price from batch splits
 */
export function calculateTotalSellingPrice(splits: IBatchSplit[]): number {
  return splits.reduce(
    (sum, split) => sum + (split.sellingPrice * split.quantity),
    0
  );
}

