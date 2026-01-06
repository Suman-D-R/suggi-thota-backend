// Hero Banner routes
import { Router } from 'express';
import { heroBannerController } from '../controllers/heroBanner.controller';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validationMiddlewares } from '../middlewares/validate.middleware';
import { validators } from '../utils/validators';
import { uploadHeroBannerImage } from '../middlewares/upload.middleware';

const router = Router();

// Public routes (no auth required for browsing)
router.get(
  '/',
  heroBannerController.getAllHeroBanners as any
);

// Get active hero banners (public endpoint)
router.get(
  '/active',
  heroBannerController.getActiveHeroBanners as any
);

// Get banners by store ID
router.get(
  '/store/:storeId',
  validators.objectIdValidation('storeId'),
  validationMiddlewares.handleValidationErrors,
  heroBannerController.getBannersByStore as any
);

router.get(
  '/:id',
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  heroBannerController.getHeroBannerById as any
);

// Admin only routes
// Create new hero banner
router.post(
  '/',
  authenticate as any,
  requireAdmin as any,
  uploadHeroBannerImage,
  validators.stringValidation('title', { required: true, minLength: 1, maxLength: 200 }),
  validators.stringValidation('subtitle', { required: true, minLength: 1, maxLength: 500 }),
  validationMiddlewares.handleValidationErrors,
  heroBannerController.createHeroBanner as any
);

// Update hero banner (change banner)
router.put(
  '/:id',
  authenticate as any,
  requireAdmin as any,
  uploadHeroBannerImage,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  heroBannerController.updateHeroBanner as any
);

router.delete(
  '/:id',
  authenticate as any,
  requireAdmin as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  heroBannerController.deleteHeroBanner as any
);

// Hard delete (permanent)
router.delete(
  '/:id/hard',
  authenticate as any,
  requireAdmin as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  heroBannerController.hardDeleteHeroBanner as any
);

export default router;

