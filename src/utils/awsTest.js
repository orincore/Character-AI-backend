import { S3Client, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

/**
 * Test AWS credentials and S3 access
 */
export const testAWSCredentials = async () => {
  try {
    console.log('Testing AWS credentials...');
    console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Not set');
    console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? 'Set (length: ' + process.env.AWS_SECRET_ACCESS_KEY.length + ')' : 'Not set');
    console.log('AWS_REGION:', process.env.AWS_REGION);
    console.log('AWS_S3_BUCKET:', process.env.AWS_S3_BUCKET);

    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    // Test 1: List buckets (basic credential test)
    console.log('\n1. Testing basic credentials with ListBuckets...');
    const listCommand = new ListBucketsCommand({});
    const listResult = await s3Client.send(listCommand);
    console.log('✅ Credentials are valid. Found buckets:', listResult.Buckets?.map(b => b.Name));

    // Test 2: Check specific bucket access
    console.log('\n2. Testing bucket access...');
    const headCommand = new HeadBucketCommand({ Bucket: process.env.AWS_S3_BUCKET });
    await s3Client.send(headCommand);
    console.log('✅ Bucket access confirmed for:', process.env.AWS_S3_BUCKET);

    return { success: true, message: 'AWS credentials and bucket access verified' };
  } catch (error) {
    console.error('❌ AWS Test Failed:', {
      code: error.Code,
      message: error.message,
      statusCode: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId
    });
    return { success: false, error: error.message };
  }
};

/**
 * Test endpoint for AWS credentials
 */
export const testAWSEndpoint = async (req, res) => {
  const result = await testAWSCredentials();
  res.status(result.success ? 200 : 500).json(result);
};
