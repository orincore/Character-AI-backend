import { createClient } from '@supabase/supabase-js';
import env from './env.js';
import bcrypt from 'bcryptjs';

// Initialize Supabase clients
const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// Helper function to handle Supabase errors
const handleSupabaseError = (error, context = '') => {
  if (error) {
    console.error(`Supabase Error [${context}]:`, error);
    throw new Error(error.message || `Database error occurred: ${context}`);
  }
};

// User operations
export const userDB = {
  // Create a new user with email and password
  async signUpWithEmail(email, password, userData) {
    try {
      // Hash the password for direct storage
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Create user profile directly (bypass Supabase auth entirely)
      const { data: profileData, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert([
          {
            email,
            username: userData.username,
            first_name: userData.first_name,
            last_name: userData.last_name,
            phone_number: userData.phone_number,
            gender: userData.gender,
            age: userData.age,
            password: hashedPassword, // Store hashed password directly
            plan: 'free',
            is_verified: true // Since we're bypassing email verification
          },
        ])
        .select()
        .single();
        
      if (profileError) {
        console.error('Profile creation error:', profileError);
        throw new Error(profileError.message || 'Failed to create user profile');
      }
      
      return { 
        user: { 
          id: profileData.id, 
          email: profileData.email,
          user_metadata: {
            full_name: `${profileData.first_name} ${profileData.last_name}`.trim()
          }
        }, 
        profile: profileData 
      };
      
    } catch (error) {
      console.error('Error in signUpWithEmail:', error);
      throw error;
    }
  },
  
  // Sign in with email and password
  async signInWithEmail(email, password) {
    try {
      // First try standard auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        console.warn('Standard auth failed, trying direct profile lookup:', error);
        
        // If auth fails, try direct profile lookup and password check
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('user_profiles')
          .select('*')
          .or(`email.eq.${email},username.eq.${email}`)
          .single();
          
        if (profileError || !profile) {
          throw new Error('Invalid credentials');
        }
        
        // Check password
        const isPasswordValid = await bcrypt.compare(password, profile.password);
        if (!isPasswordValid) {
          throw new Error('Invalid credentials');
        }
        
        // Create a user-like object for compatibility
        return { 
          user: { 
            id: profile.id, 
            email: profile.email,
            user_metadata: {
              full_name: `${profile.first_name} ${profile.last_name}`.trim()
            }
          },
          session: {
            access_token: 'direct_auth',
            refresh_token: 'direct_auth',
            user: {
              id: profile.id,
              email: profile.email
            }
          },
          profile
        };
      }
      
      // If standard auth worked, get the profile
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
        
      if (profileError) throw profileError;
      
      return { ...data, profile };
      
    } catch (error) {
      console.error('Error in signInWithEmail:', error);
      throw error;
    }
  },
  
  // Get user by ID
  async getUserById(userId) {
    try {
      // First try to get from auth
      try {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (!authError && authData.user) {
          const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();
          return { ...authData.user, ...profile };
        }
      } catch (e) {
        console.warn('Error getting user from auth, falling back to direct profile:', e);
      }
      
      // Fall back to direct profile lookup
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (error && error.code !== 'PGRST116') { // Ignore 'not found' errors
        console.error('Error getting user profile:', error);
        throw error;
      }
      
      return data || null;
      
    } catch (error) {
      console.error('Error in getUserById:', error);
      throw error;
    }
  },
  
  // Update user profile
  async updateProfile(userId, updates) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
      
    handleSupabaseError(error);
    return data;
  },
  
  // Delete user from user_profiles table
  async deleteUser(userId) {
    const { error } = await supabase
      .from('user_profiles')
      .delete()
      .eq('id', userId);
      
    if (error) {
      console.error('Error deleting user profile:', error);
      throw new Error('Failed to delete user profile');
    }
    
    return true;
  },
  
  // Find user by email, username, or phone
  async findUserByIdentifier(identifier) {
    try {
      // Try direct profile lookup first (faster)
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .or(`email.eq.${identifier},username.eq.${identifier},phone_number.eq.${identifier}`)
        .single();
        
      if (!error && data) {
        return data;
      }
      
      // If not found in profiles, try auth users
      if (error?.code === 'PGRST116') { // Not found
        try {
          // Try to get by email
          const { data: authData, error: authError } = await supabaseAdmin
            .from('auth.users')
            .select('*')
            .eq('email', identifier)
            .single();
            
          if (!authError && authData) {
            // Get the profile too
            const { data: profile } = await supabaseAdmin
              .from('user_profiles')
              .select('*')
              .eq('id', authData.id)
              .single();
              
            return { ...authData, ...profile };
          }
        } catch (e) {
          console.warn('Error checking auth.users:', e);
        }
      }
      
      return null;
      
    } catch (error) {
      console.error('Error in findUserByIdentifier:', error);
      throw error;
    }
  }
};

export default supabase;
