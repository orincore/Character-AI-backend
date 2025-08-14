import sharp from 'sharp';

/**
 * Compresses and resizes an image buffer
 * @param {Buffer} imageBuffer - The image buffer to process
 * @param {Object} options - Processing options
 * @param {number} [options.maxWidth=800] - Maximum width in pixels
 * @param {number} [options.quality=80] - JPEG/PNG quality (1-100)
 * @returns {Promise<Buffer>} - Processed image buffer
 */
export const processImage = async (imageBuffer, options = {}) => {
  const {
    maxWidth = 800,
    quality = 80,
  } = options;

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    // Convert to WebP for better compression
    const processedImage = image
      .resize({
        width: Math.min(metadata.width, maxWidth),
        height: Math.round(metadata.height * (maxWidth / metadata.width)),
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality,
        effort: 6, // Higher effort = better compression but slower
        alphaQuality: 90,
      });

    return processedImage.toBuffer();
  } catch (error) {
    console.error('Error processing image:', error);
    throw new Error('Failed to process image');
  }
};

/**
 * Gets the appropriate content type and file extension for the processed image
 * @returns {Object} Object with contentType and fileExtension
 */
export const getImageOutputConfig = () => ({
  contentType: 'image/webp', // Using WebP for best compression
  fileExtension: 'webp',
});
