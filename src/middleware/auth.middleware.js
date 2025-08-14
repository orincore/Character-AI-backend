import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import supabase, { userDB } from '../config/supabaseClient.js';
import AppError from '../utils/appError.js';

// Protect routes - require authentication
export const protect = async (req, res, next) => {
  try {
    // 1) Get token from header
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return next(
        new AppError('You are not logged in! Please log in to get access.', 401)
      );
    }

    // 2) Verify token
    const decoded = await jwt.verify(token, process.env.JWT_SECRET);

    // 3) Check if user still exists
    const user = await userDB.getUserById(decoded.id);

    if (!user) {
      return next(
        new AppError('The user belonging to this token no longer exists.', 401)
      );
    }

    // 4) Check if user changed password after the token was issued
    if (user.password_changed_at) {
      const changedTimestamp = new Date(user.password_changed_at).getTime() / 1000;
      if (decoded.iat < changedTimestamp) {
        return next(
          new AppError('User recently changed password! Please log in again.', 401)
        );
      }
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = user;
    res.locals.user = user;
    next();
  } catch (error) {
    return next(new AppError('Invalid token or session expired', 401));
  }
};

// Restrict to certain roles
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles is an array of allowed roles ['admin', 'moderator']
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }
    next();
  };
};

// Only for rendered pages, no errors
export const isLoggedIn = async (req, res, next) => {
  if (req.cookies?.jwt) {
    try {
      // 1) Verify token
      const decoded = await promisify(jwt.verify)(
        req.cookies.jwt,
        process.env.JWT_SECRET
      );

      // 2) Check if user still exists
      const user = await userDB.getUserById(decoded.id);

      if (!user) {
        return next();
      }

      // 3) Check if user changed password after the token was issued
      if (user.password_changed_at) {
        const changedTimestamp = new Date(user.password_changed_at).getTime() / 1000;
        if (decoded.iat < changedTimestamp) {
          return next();
        }
      }

      // THERE IS A LOGGED IN USER
      res.locals.user = user;
      return next();
    } catch (err) {
      return next();
    }
  }
  next();
};
