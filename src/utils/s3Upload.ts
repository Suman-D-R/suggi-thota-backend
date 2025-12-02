// S3 upload utility
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3, s3Config } from '../config/aws';
import { envConfig } from '../config/env';
import { logger } from './logger';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
  etag?: string;
}

export interface SignedUrlOptions {
  expires?: number;
  contentType?: string;
}

// Upload file to S3
export const uploadToS3 = async (
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  folder: string = 'uploads'
): Promise<UploadResult> => {
  try {
    const fileExtension = path.extname(fileName);
    const baseName = path.basename(fileName, fileExtension);
    const uniqueFileName = `${baseName}-${uuidv4()}${fileExtension}`;
    const key = `${folder}/${uniqueFileName}`;

    const command = new PutObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      // ACL removed - bucket doesn't allow ACLs
    });

    const result = await s3.send(command);

    logger.info(`File uploaded to S3: ${key}`);

    return {
      key,
      url: `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`,
      bucket: s3Config.bucketName,
      etag: result.ETag,
    };
  } catch (error) {
    logger.error('Error uploading to S3:', error);
    throw new Error('Failed to upload file to S3');
  }
};

// Delete file from S3
export const deleteFromS3 = async (key: string): Promise<void> => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
    });

    await s3.send(command);
    logger.info(`File deleted from S3: ${key}`);
  } catch (error) {
    logger.error('Error deleting from S3:', error);
    throw new Error('Failed to delete file from S3');
  }
};

// Generate signed URL for private files
export const getSignedUrlForObject = async (
  key: string,
  options: SignedUrlOptions = {}
): Promise<string> => {
  try {
    const { expires = s3Config.signedUrlExpiry } = options;

    const command = new GetObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
    });

    return await getSignedUrl(s3, command, { expiresIn: expires });
  } catch (error) {
    logger.error('Error generating signed URL:', error);
    throw new Error('Failed to generate signed URL');
  }
};

// Generate signed URL for upload
export const getSignedUploadUrl = async (
  key: string,
  contentType: string,
  expires: number = 3600
): Promise<string> => {
  try {
    const command = new PutObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
      ContentType: contentType,
      // ACL removed - bucket doesn't allow ACLs
    });

    return await getSignedUrl(s3, command, { expiresIn: expires });
  } catch (error) {
    logger.error('Error generating signed upload URL:', error);
    throw new Error('Failed to generate signed upload URL');
  }
};

// Check if file exists in S3
export const fileExistsInS3 = async (key: string): Promise<boolean> => {
  try {
    const command = new HeadObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
    });

    await s3.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return false;
    }
    logger.error('Error checking file existence in S3:', error);
    throw new Error('Failed to check file existence in S3');
  }
};

// Get file metadata from S3
export const getFileMetadata = async (key: string) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
    });

    const result = await s3.send(command);
    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      lastModified: result.LastModified,
      etag: result.ETag,
    };
  } catch (error) {
    logger.error('Error getting file metadata from S3:', error);
    throw new Error('Failed to get file metadata from S3');
  }
};

// Generate unique file key
export const generateFileKey = (
  originalName: string,
  folder: string = 'uploads',
  prefix: string = ''
): string => {
  const fileExtension = path.extname(originalName);
  const baseName = path.basename(originalName, fileExtension);
  const timestamp = Date.now();
  const uniqueId = uuidv4().substring(0, 8);

  const fileName = prefix
    ? `${prefix}-${baseName}-${timestamp}-${uniqueId}${fileExtension}`
    : `${baseName}-${timestamp}-${uniqueId}${fileExtension}`;

  return `${folder}/${fileName}`;
};

// Validate file type
export const isValidFileType = (mimeType: string): boolean => {
  return envConfig.ALLOWED_FILE_TYPES.includes(mimeType);
};

// Validate file size
export const isValidFileSize = (fileSize: number): boolean => {
  return fileSize <= envConfig.MAX_FILE_SIZE;
};

// S3 utility functions object
export const s3Upload = {
  uploadToS3,
  deleteFromS3,
  getSignedUrl: getSignedUrlForObject,
  getSignedUploadUrl,
  fileExistsInS3,
  getFileMetadata,
  generateFileKey,
  isValidFileType,
  isValidFileSize,
};

