// Product enrichment utilities - Combine Product with StoreProduct and InventoryBatch data
// NOTE: This file needs to be updated to use StoreProduct and InventoryBatch instead of ProductBatch
import { Product } from '../models/product.model';
import { StoreProduct } from '../models/storeProduct.model';
import { InventoryBatch } from '../models/inventoryBatch.model';
import mongoose from 'mongoose';

export interface EnrichedProduct {
  _id: mongoose.Types.ObjectId;
  name: string;
  category: mongoose.Types.ObjectId | string | any;
  size: number;
  unit: string;
  variants?: Array<{ 
    size: number; 
    unit: string;
    originalPrice?: number;
    sellingPrice?: number;
    discount?: number;
    stock?: number;
    isOutOfStock?: boolean;
  }>; // Product variants with pricing
  images: string[];
  attributes: Map<string, string> | any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  
  // Enriched from batches (backward compatibility - uses first variant or highest price)
  discount?: number; // Discount percentage from highest price batch
  stock?: number; // Total available stock across all batches
  originalPrice?: number; // Original price from highest price batch
  sellingPrice?: number; // Selling price from highest price batch
  averageCostPerQuantity?: number; // Average cost per quantity across all batches
  isOutOfStock?: boolean; // True if product is out of stock or not active
  status?: string; // Product status based on isActive: 'active' or 'inactive'
}

/**
 * Helper function to enrich a variant with batch data
 */
function enrichVariant(variant: { size: number; unit: string }, batches: any[]): any {
  const enrichedVariant: any = {
    ...variant,
    stock: 0,
    originalPrice: 0,
    sellingPrice: 0,
    discount: 0,
    isOutOfStock: true,
  };

  // Normalize variant size and unit for comparison
  const variantSize = Number(variant.size);
  const variantUnit = String(variant.unit).toLowerCase().trim();

  // Collect all selling variants from batches that match this product variant
  const matchingSellingVariants: any[] = [];
  
  batches.forEach((batch) => {
    if (batch.sellingVariants && Array.isArray(batch.sellingVariants)) {
      batch.sellingVariants.forEach((sellingVariant: any) => {
        // Normalize selling variant size and unit for comparison
        const svSize = Number(sellingVariant.sellingSize);
        const svUnit = String(sellingVariant.sellingUnit).toLowerCase().trim();
        
        // Match by size and unit (handle type conversions)
        if (svSize === variantSize && svUnit === variantUnit) {
          matchingSellingVariants.push({
            ...sellingVariant,
            batchId: batch._id,
          });
        }
      });
    }
  });

  if (matchingSellingVariants.length === 0) {
    // No matching selling variants found - return variant with zeros
    return enrichedVariant;
  }

  // Calculate total stock for this variant (sum across all batches)
  enrichedVariant.stock = matchingSellingVariants.reduce(
    (sum, sv) => sum + (Number(sv.quantityAvailable) || 0),
    0
  );

  enrichedVariant.isOutOfStock = enrichedVariant.stock === 0;

  // Find selling variant with highest selling price across all batches
  // If multiple batches have the same variant, use the one with highest price
  // Include variants even if stock is 0, to show prices
  const sortedVariants = [...matchingSellingVariants].sort((a, b) => {
    const priceA = Number(a.sellingPrice) || 0;
    const priceB = Number(b.sellingPrice) || 0;
    return priceB - priceA; // Descending order (highest first)
  });
  const highestPriceVariant = sortedVariants[0];

  if (highestPriceVariant) {
    const sellingPrice = Number(highestPriceVariant.sellingPrice) || 0;
    const originalPrice = Number(highestPriceVariant.originalPrice) || 0;
    const discount = Number(highestPriceVariant.discount) || 0;
    
    // Set prices even if stock is 0 (to show pricing information)
    enrichedVariant.originalPrice = originalPrice;
    enrichedVariant.sellingPrice = sellingPrice;
    enrichedVariant.discount = discount;
  }

  return enrichedVariant;
}

/**
 * Enrich a single product with batch data
 */
export async function enrichProduct(product: any): Promise<EnrichedProduct> {
  // Ensure product._id is properly converted to ObjectId for querying
  const productId = product._id instanceof mongoose.Types.ObjectId 
    ? product._id 
    : new mongoose.Types.ObjectId(product._id);
  
  // NOTE: This function needs to be updated to use StoreProduct and InventoryBatch
  // For now, returning product without enrichment to prevent crashes
  // TODO: Update to use store-specific pricing and inventory
  const batches: any[] = [];
  // const batches = await InventoryBatch.find({
  //   productId: productId,
  // })
  //   .sort({ createdAt: -1 })
  //   .lean();
  
  // Filter batches that have sellingVariants (we'll use all batches to get prices, even if stock is 0)
  const batchesWithVariants = batches.filter((batch) => {
    return batch.sellingVariants && Array.isArray(batch.sellingVariants) && batch.sellingVariants.length > 0;
  });

  // Convert product to plain object for proper serialization
  const productObj = product.toObject ? product.toObject() : product;
  
  // Create enriched object with all fields explicitly set
  const enriched: any = {
    ...productObj,
    // Always include enriched fields, even if 0
    stock: 0,
    discount: 0,
    originalPrice: 0,
    sellingPrice: 0,
    averageCostPerQuantity: 0,
    isOutOfStock: false,
    variants: [], // Initialize as empty - will be populated only from batches
  };

  // Check if product is active
  enriched.status = productObj.isActive ? 'active' : 'inactive';

  // Collect all unique selling variants ONLY from batches (don't show product variants if no batches match)
  const allSellingVariants = new Map<string, { size: number; unit: string }>();
  
  // Only add selling variants from batches - these are the actual available variants
  batchesWithVariants.forEach((batch: any) => {
    if (batch.sellingVariants && Array.isArray(batch.sellingVariants)) {
      batch.sellingVariants.forEach((sv: any) => {
        const key = `${sv.sellingSize}_${sv.sellingUnit}`;
        if (!allSellingVariants.has(key)) {
          allSellingVariants.set(key, { size: Number(sv.sellingSize), unit: String(sv.sellingUnit) });
        }
      });
    }
  });
  
  // Convert to array - these are the variants that actually exist in batches
  const variants = Array.from(allSellingVariants.values());

  // Only enrich variants that exist in batches - don't show product variants if no batches match
  if (variants.length === 0) {
    // No batches with sellingVariants - set variants to empty array
    enriched.variants = [];
    enriched.isOutOfStock = true;
    return enriched;
  }

  enriched.variants = variants.map((variant: any) => enrichVariant(variant, batchesWithVariants));

  if (batchesWithVariants.length === 0) {
    // No batches - product is out of stock
    enriched.isOutOfStock = true;
    return enriched;
  }

  // Calculate total stock across all batches (sum of all selling variants with stock > 0)
  enriched.stock = batchesWithVariants.reduce((sum, batch) => {
    if (batch.sellingVariants && Array.isArray(batch.sellingVariants)) {
      return sum + batch.sellingVariants.reduce((svSum: number, sv: any) => {
        const qty = Number(sv.quantityAvailable) || 0;
        return svSum + qty;
      }, 0);
    }
    return sum;
  }, 0);

  // Determine if out of stock: product not active OR stock is 0
  enriched.isOutOfStock = !productObj.isActive || enriched.stock === 0;

  // Calculate average cost per quantity across all batches
  const totalCost = batchesWithVariants.reduce(
    (sum, batch) => sum + (Number(batch.totalCost) || 0),
    0
  );
  const totalQuantityPurchased = batchesWithVariants.reduce(
    (sum, batch) => sum + (Number(batch.quantityPurchased) || 0),
    0
  );
  enriched.averageCostPerQuantity = totalQuantityPurchased > 0
    ? totalCost / totalQuantityPurchased
    : 0;

  // For backward compatibility, set product-level prices from the first variant with stock
  // or highest price variant
  const variantsWithStock = enriched.variants.filter((v: any) => v.stock > 0);
  if (variantsWithStock.length > 0) {
    // Use the variant with highest selling price
    const highestPriceVariant = variantsWithStock.reduce((prev: any, curr: any) => {
      return (curr.sellingPrice || 0) > (prev.sellingPrice || 0) ? curr : prev;
    });
    enriched.originalPrice = highestPriceVariant.originalPrice || 0;
    enriched.sellingPrice = highestPriceVariant.sellingPrice || 0;
    enriched.discount = highestPriceVariant.discount || 0;
  } else {
    // No stock, but try to get prices from any variant
    const sortedVariants = [...enriched.variants].sort((a: any, b: any) => {
      return (b.sellingPrice || 0) - (a.sellingPrice || 0);
    });
    if (sortedVariants.length > 0 && sortedVariants[0].sellingPrice > 0) {
      enriched.originalPrice = sortedVariants[0].originalPrice || 0;
      enriched.sellingPrice = sortedVariants[0].sellingPrice || 0;
      enriched.discount = sortedVariants[0].discount || 0;
    }
  }

  return enriched;
}

/**
 * Enrich multiple products with batch data
 */
export async function enrichProducts(products: any[]): Promise<EnrichedProduct[]> {
  if (products.length === 0) return [];

  const productIds = products.map((p) =>
    p._id instanceof mongoose.Types.ObjectId ? p._id : new mongoose.Types.ObjectId(p._id)
  );

  // NOTE: This function needs to be updated to use StoreProduct and InventoryBatch
  // For now, returning products without enrichment to prevent crashes
  // TODO: Update to use store-specific pricing and inventory
  const batches: any[] = [];
  // const batches = await InventoryBatch.find({
  //   productId: { $in: productIds },
  // })
  //   .sort({ createdAt: -1 })
  //   .lean();

  // Group batches by product (include all batches with sellingVariants)
  const batchesByProduct = batches.reduce((acc: any, batch: any) => {
    // Include batches that have sellingVariants
    const hasVariants = batch.sellingVariants && Array.isArray(batch.sellingVariants) && batch.sellingVariants.length > 0;
    
    if (hasVariants) {
      // Handle both ObjectId and string formats
      const batchProductId = batch.product instanceof mongoose.Types.ObjectId 
        ? batch.product.toString() 
        : String(batch.product);
      if (!acc[batchProductId]) {
        acc[batchProductId] = [];
      }
      acc[batchProductId].push(batch);
    }
    return acc;
  }, {});

  // Enrich each product
  return products.map((product: any) => {
    // Normalize product ID to string for matching
    const productId = product._id instanceof mongoose.Types.ObjectId
      ? product._id.toString()
      : String(product._id);
    const productBatches = batchesByProduct[productId] || [];

    // Convert product to plain object for proper serialization
    const productObj = product.toObject ? product.toObject() : product;
    
    // Create enriched object with all fields explicitly set
    const enriched: any = {
      ...productObj,
      // Always include enriched fields, even if 0
      stock: 0,
      discount: 0,
      originalPrice: 0,
      sellingPrice: 0,
      averageCostPerQuantity: 0,
      isOutOfStock: false,
      variants: [], // Initialize as empty - will be populated only from batches
    };

    // Check if product is active
    const isProductActive = productObj.isActive !== false;
    enriched.status = isProductActive ? 'active' : 'inactive';

    // Collect all unique selling variants ONLY from batches (don't show product variants if no batches match)
    const allSellingVariants = new Map<string, { size: number; unit: string }>();
    
    // Only add selling variants from batches - these are the actual available variants
    productBatches.forEach((batch: any) => {
      if (batch.sellingVariants && Array.isArray(batch.sellingVariants)) {
        batch.sellingVariants.forEach((sv: any) => {
          const key = `${sv.sellingSize}_${sv.sellingUnit}`;
          if (!allSellingVariants.has(key)) {
            allSellingVariants.set(key, { size: Number(sv.sellingSize), unit: String(sv.sellingUnit) });
          }
        });
      }
    });
    
    // Convert to array - these are the variants that actually exist in batches
    const variants = Array.from(allSellingVariants.values());

    // Only enrich variants that exist in batches - don't show product variants if no batches match
    if (variants.length === 0) {
      // No batches with sellingVariants - set variants to empty array
      enriched.variants = [];
      enriched.isOutOfStock = !isProductActive || true;
      return enriched;
    }

    enriched.variants = variants.map((variant: any) => enrichVariant(variant, productBatches));

    if (productBatches.length === 0) {
      // No batches or no stock available - product is out of stock
      enriched.isOutOfStock = !isProductActive || enriched.stock === 0;
      return enriched;
    }

    // Calculate total stock across all batches (sum of all selling variants)
    enriched.stock = productBatches.reduce((sum: number, batch: any) => {
      if (batch.sellingVariants && Array.isArray(batch.sellingVariants)) {
        return sum + batch.sellingVariants.reduce((svSum: number, sv: any) => svSum + (sv.quantityAvailable || 0), 0);
      }
      return sum;
    }, 0);

    // Determine if out of stock: product not active OR stock is 0
    enriched.isOutOfStock = !isProductActive || enriched.stock === 0;

    // Calculate average cost per quantity across all batches
    const totalCost = productBatches.reduce(
      (sum: number, batch: any) => sum + (batch.totalCost || 0),
      0
    );
    const totalQuantityPurchased = productBatches.reduce(
      (sum: number, batch: any) => sum + (batch.quantityPurchased || 0),
      0
    );
    enriched.averageCostPerQuantity = totalQuantityPurchased > 0
      ? totalCost / totalQuantityPurchased
      : 0;

    // For backward compatibility, set product-level prices from the first variant with stock
    // or highest price variant
    const variantsWithStock = enriched.variants.filter((v: any) => v.stock > 0);
    if (variantsWithStock.length > 0) {
      // Use the variant with highest selling price
      const highestPriceVariant = variantsWithStock.reduce((prev: any, curr: any) => {
        return (curr.sellingPrice || 0) > (prev.sellingPrice || 0) ? curr : prev;
      });
      enriched.originalPrice = highestPriceVariant.originalPrice || 0;
      enriched.sellingPrice = highestPriceVariant.sellingPrice || 0;
      enriched.discount = highestPriceVariant.discount || 0;
    } else {
      // No stock, but try to get prices from any variant
      const sortedVariants = [...enriched.variants].sort((a: any, b: any) => {
        return (b.sellingPrice || 0) - (a.sellingPrice || 0);
      });
      if (sortedVariants.length > 0 && sortedVariants[0].sellingPrice > 0) {
        enriched.originalPrice = sortedVariants[0].originalPrice || 0;
        enriched.sellingPrice = sortedVariants[0].sellingPrice || 0;
        enriched.discount = sortedVariants[0].discount || 0;
      }
    }

    return enriched;
  });
}

