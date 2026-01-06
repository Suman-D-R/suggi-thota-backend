# Inventory Batch Model Improvements

## Summary of Changes

The `InventoryBatch` model has been significantly enhanced to better support inventory management with improved tracking, metadata, and support for different stock management types.

## Key Improvements

### 1. Stock Tracking
- **Before**: Single `quantity` field
- **After**: 
  - `initialQuantity`: Original quantity when batch was created
  - `availableQuantity`: Current available stock (decreases with orders)
  - Tracks actual available stock separately from initial batch size

### 2. Stock Management Types
- **Variant-Specific Stock** (`usesSharedStock: false`):
  - Each variant has separate batches (e.g., rice: 1kg bags, 5kg bags are separate)
  - Requires `variantSku` field
  - Used for packaged/pre-packaged goods

- **Shared Stock** (`usesSharedStock: true`):
  - One batch serves all variants, stock is shared across variants
  - Used for bulk goods like vegetables
  - Requires `baseUnit` field (e.g., 'kg', 'g')
  - `variantSku` is optional/null
  - When ordering different variants (500g, 1kg, 2kg), stock is managed based on total stock in base unit

### 3. Enhanced Metadata for Store Owners
- `batchNumber`: Batch/GRN number for tracking
- `supplier`: Supplier name
- `purchaseDate`: Date of purchase
- `expiryDate`: Expiry date (enhanced tracking)
- `notes`: Additional comments/notes
- `status`: Batch status (active, expired, depleted, cancelled)

### 4. Status Management
- Automatic status updates:
  - Sets to `depleted` when `availableQuantity` reaches 0
  - Sets to `expired` when `expiryDate` has passed
- Manual status control: `active`, `expired`, `depleted`, `cancelled`

### 5. Virtual Properties
- `isExpired`: Checks if batch has expired
- `isAvailable`: Checks if batch is available (active, not expired, has stock)

### 6. Indexes
- Enhanced indexes for efficient queries:
  - `{ storeId: 1, productId: 1 }`
  - `{ storeId: 1, productId: 1, variantSku: 1 }`
  - `{ storeId: 1, productId: 1, status: 1 }`
  - `{ status: 1, expiryDate: 1 }` (for finding expired batches)
  - `{ batchNumber: 1 }` (for batch number lookup)

## Updated Controllers

### InventoryBatch Controller
- Updated to handle new fields (initialQuantity, availableQuantity, usesSharedStock, baseUnit, metadata fields)
- Added `updateStoreProductStockForShared()` for shared stock products
- Updated `updateStoreProductStock()` to use `availableQuantity` and check expiry
- Added status filtering in queries

### Order Controller
- Updated to use `availableQuantity` instead of `quantity`
- Added status and expiry checks when allocating batches
- Updated stock reduction to use `availableQuantity`

### Cart Controller
- Updated to use `availableQuantity` instead of `quantity`
- Added status and expiry checks when checking stock

## API Changes

### Create Inventory Batch
```typescript
{
  storeId: string (required)
  productId: string (required)
  initialQuantity: number (required)
  costPrice: number (required)
  variantSku?: string (required if usesSharedStock: false)
  usesSharedStock?: boolean (default: false)
  baseUnit?: 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack' (required if usesSharedStock: true)
  batchNumber?: string
  supplier?: string
  purchaseDate?: Date
  expiryDate?: Date
  notes?: string
  status?: 'active' | 'expired' | 'depleted' | 'cancelled' (default: 'active')
}
```

### Update Inventory Batch
All fields from create can be updated, plus:
- `availableQuantity`: Can be set directly (cannot exceed initialQuantity)

## Migration Notes

⚠️ **Important**: Existing batches in the database will need to be migrated:
1. `quantity` field needs to be mapped to both `initialQuantity` and `availableQuantity`
2. All existing batches should have `usesSharedStock: false` by default
3. Status should be set based on quantity and expiry date

## Future Work: Shared Stock Implementation

The schema now supports shared stock, but the full implementation requires:

1. **Order Controller Updates**:
   - Convert variant sizes to base unit when ordering shared stock products
   - Example: Order 2kg of tomatoes from a 100kg batch (baseUnit: 'kg')
   - Deduct 2 from availableQuantity (not 2kg as a separate variant)

2. **Stock Allocation Logic**:
   - For shared stock: Query batches by productId only (no variantSku filter)
   - Convert variant size to base unit before deducting
   - Handle unit conversions (g to kg, ml to liter, etc.)

3. **Cart/Product Display**:
   - Show available stock correctly for shared stock products
   - All variants should show the same total available stock

4. **Stock Validation**:
   - When ordering 500g variant from a 10kg batch, validate that 0.5kg is available
   - Handle unit conversions properly

## Example Usage

### Variant-Specific Stock (Rice)
```javascript
{
  storeId: "...",
  productId: "...",
  variantSku: "RICE-1KG",
  initialQuantity: 100,
  availableQuantity: 100,
  costPrice: 50,
  usesSharedStock: false,
  batchNumber: "GRN-001",
  supplier: "Rice Supplier Co.",
  purchaseDate: "2024-01-15",
  expiryDate: "2025-01-15"
}
```

### Shared Stock (Tomatoes)
```javascript
{
  storeId: "...",
  productId: "...",
  initialQuantity: 100, // 100kg
  availableQuantity: 100,
  costPrice: 30, // per kg
  usesSharedStock: true,
  baseUnit: "kg",
  batchNumber: "GRN-002",
  supplier: "Vegetable Market",
  purchaseDate: "2024-01-20",
  expiryDate: "2024-01-27"
}
```

When a customer orders 2kg of tomatoes, the system should:
1. Find the shared stock batch (by productId only)
2. Convert 2kg to base unit (already kg, so 2)
3. Deduct 2 from availableQuantity
4. Update status to 'depleted' if availableQuantity reaches 0

