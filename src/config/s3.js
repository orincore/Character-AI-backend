import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import env from './env.js';

const REGION = env.AWS_REGION || process.env.AWS_REGION;
const BUCKET = env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;

if (!REGION || !BUCKET) {
  console.warn('[S3] Missing AWS_REGION or S3_BUCKET_NAME in env. S3 uploads will fail until configured.');
}

export async function deleteFromS3({ Key }) {
  if (!BUCKET) throw new Error('S3_BUCKET_NAME is not configured');
  if (!Key) throw new Error('Missing Key for deleteFromS3');
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key });
  await s3.send(command);
  return { bucket: BUCKET, key: Key, deleted: true };
}

export function getKeyFromUrl(url) {
  try {
    const u = new URL(url);
    // pathname begins with '/'
    const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return key;
  } catch (e) {
    // Fallback: if it's not a full URL, assume it's already a key
    return url;
  }
}

const s3 = new S3Client({
  region: REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

// If your bucket has ACLs disabled (Object Ownership = Bucket owner enforced), do NOT send ACL
const ALLOW_ACL = process.env.ALLOW_S3_ACL === 'true';
// Ensure your CloudFront domain is set in .env as S3_PUBLIC_BASE_URL
// Example: https://media.orincore.com
const PUBLIC_BASE = (env.S3_PUBLIC_BASE_URL || process.env.S3_PUBLIC_BASE_URL || '').trim() || null;
if (PUBLIC_BASE) {
  console.log(`[S3] Using public base URL for assets: ${PUBLIC_BASE}`);
}

// Generate public URL for S3 object
function getPublicUrl(Key) {
  if (!Key) return null;
  
  // If CloudFront domain is configured, use it
  if (PUBLIC_BASE) {
    // Remove leading/trailing slashes and ensure clean concatenation
    const base = PUBLIC_BASE.replace(/\/+$/, '');
    const cleanKey = Key.replace(/^\/+/, '');
    // Return encoded path (preserve %2F) to match desired format
    return `${base}/${encodeURIComponent(cleanKey)}`;
  }
  
  // Fallback to S3 URL
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${Key}`;
}

export async function uploadToS3({ Key, Body, ContentType, Metadata = {} }) {
  if (!BUCKET) throw new Error('S3_BUCKET_NAME is not configured');
  
  // Clean the key by removing any URL encoding that might already be present
  const cleanKey = decodeURIComponent(Key).replace(/^\/+/, '');
  
  const putParams = {
    Bucket: BUCKET,
    Key: cleanKey,
    Body,
    ContentType,
    Metadata,
    // Disable ACL by default (bucket owner enforced)
    ...(ALLOW_ACL && { ACL: 'public-read' })
  };

  try {
    await s3.send(new PutObjectCommand(putParams));
    return { bucket: BUCKET, key: cleanKey, url: getPublicUrl(cleanKey) };
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw new Error('Failed to upload file to storage');
  }
}

export { s3, BUCKET as S3_BUCKET, REGION as S3_REGION };
