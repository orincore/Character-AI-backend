import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
import { userDB } from '../config/supabaseClient.js';
import AppError from '../utils/appError.js';
import env from '../config/env.js';
import { uploadToS3, deleteFromS3, getKeyFromUrl } from '../config/s3.js';
import path from 'path';

const signToken = (id) => {
  return jwt.sign({ id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
};

// Delete current user's avatar: remove from S3 and clear avatar_url
export const deleteAvatar = async (req, res, next) => {
  try {
    const user = await userDB.getUserById(req.user.id);
    if (!user) return next(new AppError('User not found', 404));

    const prevUrl = user.avatar_url;
    if (!prevUrl) {
      return res.status(200).json({ status: 'success', data: { avatar_url: null, deleted: false } });
    }

    // Try to delete object from S3
    try {
      const prevKey = getKeyFromUrl(prevUrl);
      if (prevKey) {
        await deleteFromS3({ Key: prevKey });
      }
    } catch (e) {
      console.warn('[avatar] Failed to delete avatar from S3:', e?.message || e);
    }

    // Clear field in profile
    const updated = await userDB.updateProfile(req.user.id, { avatar_url: null });
    return res.status(200).json({ status: 'success', data: { avatar_url: null, user: updated, deleted: true } });
  } catch (error) {
    next(error);
  }
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user.id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  };

  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

export const signup = async (req, res, next) => {
  try {
    const { email, password, username, phone_number, first_name, last_name, gender, age } = req.body;

    // 1) Validate required fields
    if (!email || !password || !username || !first_name || !last_name) {
      return next(new AppError('Please provide all required fields', 400));
    }

    // 2) Check if user exists
    const existingUser = await userDB.findUserByIdentifier(email) || 
                         await userDB.findUserByIdentifier(username) ||
                         (phone_number ? await userDB.findUserByIdentifier(phone_number) : null);

    if (existingUser) {
      return next(new AppError('User with this email/username/phone already exists', 400));
    }

    // 3) Create user in Supabase Auth and user_profiles
    const { user, profile, error } = await userDB.signUpWithEmail(email, password, {
      username,
      first_name,
      last_name,
      phone_number,
      gender,
      age: parseInt(age, 10)
    });

    if (error) {
      return next(new AppError(error.message || 'Error creating user', 500));
    }

    // 4) Generate JWT and send response
    createSendToken({
      id: user.id,
      email: user.email,
      ...profile
    }, 201, res);
  } catch (error) {
    next(error);
  }
};

// Upload avatar image to S3 and save URL on user profile
export const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError('No file uploaded. Expected field "avatar"', 400));
    }

    const file = req.file;
    // Get current user to check existing avatar
    const currentUser = await userDB.getUserById(req.user.id);

    // Build a safe S3 object key
    const ext = path.extname(file.originalname || '.jpg').toLowerCase();
    const filename = `${Date.now()}${ext}`;
    const key = `avatars/${req.user.id}/${filename}`;

    // Upload to S3
    const result = await uploadToS3({
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        originalname: file.originalname,
        uploadedBy: req.user.id,
      },
    });

    // Get the public URL from the result
    const avatarUrl = result.url || result;
    
    if (!avatarUrl) {
      throw new Error('Failed to generate avatar URL');
    }

    // Save the new avatar URL
    const updatedUser = await userDB.updateProfile(req.user.id, { 
      avatar_url: avatarUrl 
    });

    // Best-effort: delete previous avatar if it exists and is different
    try {
      const prevUrl = currentUser?.avatar_url;
      if (prevUrl && prevUrl !== avatarUrl) {
        const prevKey = getKeyFromUrl(prevUrl);
        if (prevKey && typeof prevKey === 'string' && prevKey !== key) {
          await deleteFromS3({ Key: prevKey }).catch(e => 
            console.warn('[avatar] Failed to delete old avatar:', e?.message || e)
          );
        }
      }
    } catch (e) {
      // Log and continue; not fatal
      console.warn('[avatar] Failed to clean up previous avatar:', e?.message || e);
    }

    res.status(200).json({
      status: 'success',
      data: {
        user: updatedUser,
        avatar_url: avatarUrl,
      },
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    // 1) Check if identifier and password exist
    if (!identifier || !password) {
      return next(new AppError('Please provide identifier and password!', 400));
    }

    // 2) Find user by identifier (email/username/phone)
    const user = await userDB.findUserByIdentifier(identifier);
    if (!user || !user.password) {
      return next(new AppError('Incorrect email/username/phone or password', 401));
    }

    // 2.5) Check if account is deactivated (soft deleted)
    if (user.hasOwnProperty('is_active') && user.is_active === false) {
      return next(new AppError('This account is closed. Please contact support to reopen.', 403));
    }

    // 3) Check if password is correct
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return next(new AppError('Incorrect email/username/phone or password', 401));
    }

    // 4) Update last login
    await userDB.updateProfile(user.id, { last_login: new Date() });

    // 5) Send token to client
    createSendToken({
      id: user.id,
      email: user.email,
      ...user
    }, 200, res);
  } catch (error) {
    next(error);
  }
};

// Get current user's data
export const getCurrentUser = async (req, res, next) => {
  try {
    // User is already attached to req by protect middleware
    const user = await userDB.getUserById(req.user.id);
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update user data
export const updateUser = async (req, res, next) => {
  try {
    // Filter out unwanted field names that are not allowed to be updated
    const filteredBody = {};
    const allowedFields = ['first_name', 'last_name', 'email', 'phone_number', 'gender', 'age', 'username'];
    
    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredBody[key] = req.body[key];
      }
    });

    // If updating password, hash it first
    if (req.body.password) {
      const salt = await bcrypt.genSalt(12);
      filteredBody.password = await bcrypt.hash(req.body.password, salt);
    }

    const updatedUser = await userDB.updateProfile(req.user.id, filteredBody);

    if (!updatedUser) {
      return next(new AppError('User not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete user account
export const deleteUser = async (req, res, next) => {
  try {
    // Soft delete: deactivate the user instead of deleting their data
    const updated = await userDB.updateProfile(req.user.id, { is_active: false });

    // Clear the JWT cookie
    res.cookie('jwt', 'loggedout', {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true
    });

    res.status(200).json({
      status: 'success',
      message: 'Account has been closed. You can contact support to reopen it.',
      data: { user: updated }
    });
  } catch (error) {
    next(error);
  }
};

export const protect = async (req, res, next) => {
  try {
    // 1) Getting token and check if it's there
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return next(
        new AppError('You are not logged in! Please log in to get access.', 401)
      );
    }

    // 2) Verify token
    const decoded = await promisify(jwt.verify)(token, env.JWT_SECRET);

    // 3) Check if user still exists in Supabase
    const currentUser = await userDB.getUserById(decoded.id);
    if (!currentUser) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // 3.5) Block access if the account is deactivated (soft deleted)
    if (currentUser.hasOwnProperty('is_active') && currentUser.is_active === false) {
      return next(new AppError('This account is closed. Please contact support to reopen.', 403));
    }

    // 4) Check if user changed password after the token was issued
    if (currentUser.password_changed_at) {
      const changedTimestamp = parseInt(
        new Date(currentUser.password_changed_at).getTime() / 1000,
        10
      );

      if (decoded.iat < changedTimestamp) {
        return next(
          new AppError('User recently changed password! Please log in again.', 401)
        );
      }
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = currentUser;
    res.locals.user = currentUser;
    next();
  } catch (error) {
    next(error);
  }
};
