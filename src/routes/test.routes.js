import express from 'express';
import { testAWSEndpoint } from '../utils/awsTest.js';

const router = express.Router();

// Test AWS credentials and S3 access
router.get('/aws', testAWSEndpoint);

export default router;
