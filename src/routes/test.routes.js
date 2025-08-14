import express from 'express';
import { testAWSEndpoint } from '../utils/awsTest.js';
import { protect } from '../middleware/auth.middleware.js';
import supabase from '../config/supabaseClient.js';

const router = express.Router();

// Test AWS credentials and S3 access
router.get('/aws', testAWSEndpoint);

// Test SQL endpoint for debugging
router.get('/sql', protect, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'SQL query parameter is required' 
      });
    }

    console.log('Executing SQL:', query);
    const { data, error } = await supabase.rpc('exec_sql', { query });
    
    if (error) {
      console.error('SQL Error:', error);
      return res.status(400).json({ 
        status: 'error', 
        message: 'SQL Error',
        error: error.message 
      });
    }

    res.status(200).json({
      status: 'success',
      results: data?.length || 0,
      data
    });
  } catch (error) {
    console.error('Error in test SQL endpoint:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

export default router;
