import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// S3 Client Configuration
const s3Config = {
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // For AWS SDK v3, we don't need signatureVersion or s3ForcePathStyle here
};

// For local development or custom endpoints
if (process.env.NODE_ENV === 'development' && process.env.AWS_S3_ENDPOINT) {
  s3Config.endpoint = process.env.AWS_S3_ENDPOINT;
  s3Config.forcePathStyle = true;
}

export const s3Client = new S3Client(s3Config);

// Validate environment variables
const validateEnvVars = () => {
  const requiredVars = ['AWS_S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
};

/**
 * Uploads a file to S3 with proper error handling and validation
 * @param {Object} params - Upload parameters
 * @param {string} params.Key - The object key (path) in the bucket
 * @param {Buffer} params.Body - The file buffer to upload
 * @param {string} params.ContentType - The file content type
 * @param {string} [params.ACL='public-read'] - The access control list setting
 * @param {string} [params.CacheControl] - Cache control header
 * @returns {Promise<Object>} Upload result
 */
export const uploadToS3 = async (params) => {
  try {
    validateEnvVars();
    
    if (!params.Key) {
      throw new Error('S3 upload requires a Key parameter');
    }
    
    if (!params.Body) {
      throw new Error('S3 upload requires a Body parameter');
    }
    
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: params.Key,
      Body: params.Body,
      ContentType: params.ContentType || 'application/octet-stream',
      ...(params.CacheControl && { CacheControl: params.CacheControl })
      // Removed ACL parameter as the bucket doesn't support ACLs
      // Public access should be configured via bucket policy instead
    };
    
    console.log(`Uploading file to S3: ${uploadParams.Key} (${params.Body.length} bytes)`);
    
    const command = new PutObjectCommand(uploadParams);
    const result = await s3Client.send(command);
    
    console.log('S3 upload successful:', {
      key: uploadParams.Key,
      size: params.Body.length,
      etag: result.ETag
    });
    
    // Generate the correct S3 URL format
    const s3Url = `https://${uploadParams.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(uploadParams.Key).replace(/%2F/g, '/')}`;
    
    return { 
      success: true, 
      key: uploadParams.Key,
      url: s3Url,
      bucket: uploadParams.Bucket,
      region: process.env.AWS_REGION,
      ...result 
    };
  } catch (error) {
    console.error('Error uploading to S3:', {
      message: error.message,
      code: error.Code || error.code,
      statusCode: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId,
      region: process.env.AWS_REGION,
      bucket: process.env.AWS_S3_BUCKET,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretKeyLength: process.env.AWS_SECRET_ACCESS_KEY?.length || 0,
      // Additional AWS-specific error details
      awsErrorCode: error.Code,
      stringToSign: error.StringToSign,
      canonicalRequest: error.CanonicalRequest
    });
    
    // Provide more helpful error messages
    if (error.Code === 'SignatureDoesNotMatch') {
      throw new Error('AWS credentials are invalid. Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
    } else if (error.Code === 'AccessDenied') {
      throw new Error('Access denied to S3 bucket. Please check bucket permissions and credentials.');
    } else if (error.Code === 'NoSuchBucket') {
      throw new Error(`S3 bucket '${process.env.AWS_S3_BUCKET}' does not exist or is not accessible.`);
    } else if (error.Code === 'AccessControlListNotSupported') {
      throw new Error('S3 bucket does not support ACLs. File uploaded but may not be publicly accessible. Configure bucket policy for public access.');
    }
    
    throw error;
  }
};

export const getPresignedUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
};
