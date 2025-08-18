import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { userDB } from '../config/supabaseClient.js';
import AppError from '../utils/appError.js';
import env from '../config/env.js';
import { uploadToS3, deleteFromS3, getKeyFromUrl } from '../config/s3.js';
import path from 'path';
import { sendEmail, buildOtpEmail, buildWelcomeEmail } from '../services/email.service.js';
import { redisClient } from '../config/redis.js';

const signToken = (id) => {
  return jwt.sign({ id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
};

// ============ Phone (WhatsApp) OTP via external OTP service ============
const OTP_BASE_URL = process.env.OTP_BASE_URL || 'https://otp.orincore.com';
const OTP_APP_NAME = env.APP_NAME || 'Clyra AI';
const OTP_API_KEY = process.env.OTP_API_KEY || '689914b5f3f23ea10283ab79';

async function isWhatsappGatewayReady() {
  try {
    const url = `${OTP_BASE_URL}/api/whatsapp/status`;
    const { data } = await axios.get(url, { timeout: 5000, headers: { 'x-api-key': OTP_API_KEY } });
    return !!(data?.success && data?.status?.isReady && data?.status?.authenticated === true);
  } catch (e) {
    console.warn('[otp] WhatsApp status check failed:', e?.message || e);
    return false;
  }
}

// Decide whether full account verification should be marked based on channel states
async function computeAndApplyFullVerification(userId) {
  // Load fresh
  const user = await userDB.getUserById(userId);
  if (!user) throw new AppError('User not found', 404);

  const hasPhone = !!user.phone_number;
  const gatewayReady = await isWhatsappGatewayReady();

  // If phone is present and gateway is ready, require BOTH email and phone
  const requirePhone = hasPhone && gatewayReady;
  const emailOk = !!user.is_email_verified || !!user.is_verified; // backward compatibility
  const phoneOk = !!user.is_phone_verified;

  const shouldBeVerified = emailOk && (!requirePhone || phoneOk);

  if (shouldBeVerified && !user.is_verified) {
    const updated = await userDB.updateProfile(userId, { is_verified: true, verified_at: new Date() });
    return updated;
  }
  // If not verified yet, return latest user
  return user;
}

// Send phone OTP (WhatsApp). Only proceeds if gateway is ready; otherwise instructs to use email verification.
export const sendPhoneVerification = async (req, res, next) => {
  try {
    const user = await userDB.getUserById(req.user.id);
    if (!user) return next(new AppError('User not found', 404));

    const ready = await isWhatsappGatewayReady();
    if (!ready) {
      return res.status(200).json({
        status: 'success',
        message: 'WhatsApp verification unavailable. Please verify via email.',
        data: { whatsapp_ready: false }
      });
    }

    const contactNumber = req.body?.contactNumber || user.phone_number;
    if (!contactNumber) {
      return next(new AppError('contactNumber is required to send OTP', 400));
    }

    const payload = {
      contactNumber,
      reason: 'account_verification',
      appName: OTP_APP_NAME
    };

    const { data } = await axios.post(`${OTP_BASE_URL}/api/otp/send`, payload, { timeout: 8000, headers: { 'x-api-key': OTP_API_KEY } });
    if (!data?.success || !data?.uuid) {
      return next(new AppError('Failed to send OTP. Please try again later.', 502));
    }

    // Store mapping in Redis with TTL returned by API (fallback 5m)
    const ttl = (typeof data.expiresIn === 'number' && data.expiresIn > 0) ? data.expiresIn : 300;
    const key = `phone_verif:${req.user.id}`;
    await redisClient.del(key);
    const value = JSON.stringify({ uuid: data.uuid, contactNumber, reason: 'account_verification' });
    const ok = await redisClient.set(key, value, ttl);
    if (!ok) {
      return next(new AppError('Failed to persist OTP session. Please retry.', 500));
    }

    res.status(200).json({
      status: 'success',
      message: 'OTP sent via WhatsApp',
      data: { uuid: data.uuid, contactNumber, expiresIn: ttl }
    });
  } catch (error) {
    next(error);
  }
};

// Confirm phone OTP.
export const verifyPhoneOtp = async (req, res, next) => {
  try {
    const user = await userDB.getUserById(req.user.id);
    if (!user) return next(new AppError('User not found', 404));

    const { otp, uuid, contactNumber } = req.body || {};
    if (!otp) return next(new AppError('otp is required', 400));

    // Load stored session
    const key = `phone_verif:${req.user.id}`;
    const cachedRaw = await redisClient.get(key);
    if (!cachedRaw) {
      return next(new AppError('OTP session expired or not found. Please request a new code.', 400));
    }
    const cached = JSON.parse(cachedRaw);

    const finalUuid = uuid || cached.uuid;
    const finalContact = contactNumber || cached.contactNumber || user.phone_number;
    if (!finalUuid || !finalContact) {
      return next(new AppError('Invalid verification session. Please resend OTP.', 400));
    }

    // Verify via external service (GET with params)
    const verifyUrl = `${OTP_BASE_URL}/api/otp/verify`;
    const { data } = await axios.get(verifyUrl, {
      params: { uuid: finalUuid, contactNumber: finalContact, otp },
      timeout: 8000,
      headers: { 'x-api-key': OTP_API_KEY }
    });

    if (!data?.success) {
      return next(new AppError('Invalid or expired OTP.', 400));
    }

    // Mark phone channel verified
    await userDB.updateProfile(user.id, { is_phone_verified: true });
    await redisClient.del(key);

    // Compute overall verification according to rules
    const updated = await computeAndApplyFullVerification(user.id);
    // If this action resulted in full verification, send welcome email
    if (!user.is_verified && updated?.is_verified) {
      try {
        const ctaUrl = env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/characters/new` : '';
        const { subject, text, html } = buildWelcomeEmail({ name: user.first_name || 'there', appName: env.APP_NAME, ctaUrl });
        await sendEmail({ to: user.email, subject, text, html });
      } catch (e) {
        console.warn('[welcome-email] Failed to send after phone verification:', e?.message || e);
      }
    }

    res.status(200).json({
      status: 'success',
      message: 'Phone verified successfully',
      data: { user: updated, verifiedFor: data.verifiedFor || 'account_verification' }
    });
  } catch (error) {
    next(error);
  }
};

// Generate a 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// Send verification OTP to current user's email
export const sendEmailVerification = async (req, res, next) => {
  try {
    const user = await userDB.getUserById(req.user.id);
    if (!user) return next(new AppError('User not found', 404));

    if (user.is_verified) {
      return res.status(200).json({ status: 'success', message: 'Email already verified.' });
    }

    const otp = generateOtp();
    const ttlSeconds = 10 * 60; // 10 minutes
    const key = `email_verif:${user.id}`;

    // Store OTP in Redis with TTL (overwrite any existing)
    await redisClient.del(key);
    const stored = await redisClient.set(key, otp, ttlSeconds);
    if (!stored) {
      return next(new AppError('Failed to create verification code. Please try again later.', 500));
    }

    const { subject, text, html } = buildOtpEmail({ name: user.first_name || 'there', otp, minutes: 10, appName: env.APP_NAME });
    const toEmail = (process.env.OTP_TEST_EMAIL && env.NODE_ENV !== 'production') ? process.env.OTP_TEST_EMAIL : user.email;
    await sendEmail({ to: toEmail, subject, text, html });

    res.status(200).json({ status: 'success', message: 'Verification code sent to your email.' });
  } catch (error) {
    next(error);
  }
};

// Verify email with OTP
export const verifyEmailOtp = async (req, res, next) => {
  try {
    const { otp } = req.body || {};
    if (!otp) return next(new AppError('OTP is required', 400));

    const user = await userDB.getUserById(req.user.id);
    if (!user) return next(new AppError('User not found', 404));

    if (user.is_verified) {
      return res.status(200).json({ status: 'success', message: 'Email already verified.' });
    }

    const key = `email_verif:${user.id}`;
    const cached = await redisClient.get(key);
    if (!cached) {
      return next(new AppError('OTP expired or not found. Please request a new code.', 400));
    }

    if (cached !== otp) {
      return next(new AppError('Invalid verification code.', 400));
    }

    // Mark channel verified
    await userDB.updateProfile(user.id, { is_email_verified: true });
    await redisClient.del(key);

    // Compute overall verification according to rules
    const updated = await computeAndApplyFullVerification(user.id);
    // If this action resulted in full verification, send welcome email
    if (!user.is_verified && updated?.is_verified) {
      try {
        const ctaUrl = env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/characters/new` : '';
        const { subject, text, html } = buildWelcomeEmail({ name: user.first_name || 'there', appName: env.APP_NAME, ctaUrl });
        await sendEmail({ to: user.email, subject, text, html });
      } catch (e) {
        console.warn('[welcome-email] Failed to send after email verification:', e?.message || e);
      }
    }

    res.status(200).json({ status: 'success', message: 'Email verified successfully.', data: { user: updated } });
  } catch (error) {
    next(error);
  }
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

    // 4) Ensure user starts unverified until OTP confirmation
    try {
      await userDB.updateProfile(user.id, { is_verified: false });
    } catch (e) {
      console.warn('[signup] Failed to set is_verified=false:', e?.message || e);
    }

    // 5) Fetch latest profile and respond
    const latest = await userDB.getUserById(user.id);
    createSendToken({
      id: user.id,
      email: user.email,
      ...latest
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
    // Require password confirmation in payload
    const { password } = req.body || {};
    if (!password) {
      return next(new AppError('Password is required to close the account.', 400));
    }

    // Fetch latest user to check password
    const user = await userDB.getUserById(req.user.id);
    if (!user || !user.password) {
      return next(new AppError('User not found', 404));
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return next(new AppError('Incorrect password', 401));
    }

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
