class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.retryAfter = statusCode === 429 ? 60 : undefined; // Default 60s for rate limits
    Error.captureStackTrace(this, this.constructor);
  }
}

// Rate limit exceeded error
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later.') {
    super(message, 429);
    this.retryAfter = 60; // 60 seconds
  }
}

// API quota exceeded error
class QuotaExceededError extends AppError {
  constructor(message = 'API quota exceeded. Please try again later.') {
    super(message, 429);
    this.retryAfter = 300; // 5 minutes
  }
}

// Service unavailable error
class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable. Please try again later.') {
    super(message, 503);
    this.retryAfter = 30; // 30 seconds
  }
}

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.message.match(/(["'])(?:(?=(\\?))\2.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

const sendErrorDev = (err, res) => {
  const response = {
    status: err.status,
    message: err.message,
    error: err,
    stack: err.stack,
  };

  // Add retry-after header for rate limiting
  if (err.statusCode === 429) {
    res.setHeader('Retry-After', err.retryAfter);
    response.retryAfter = err.retryAfter;
  }

  // This is the complete response object
  res.status(err.statusCode).json(response);
};

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    const response = {
      status: err.status,
      message: err.message,
    };

    // Add retry-after for rate limiting errors
    if (err.statusCode === 429) {
      res.setHeader('Retry-After', err.retryAfter);
      response.retryAfter = err.retryAfter;
    }

    res.status(err.statusCode).json(response);
  } 
  // Programming or other unknown error: don't leak error details
  else {
    // 1) Log error with request details
    console.error('ERROR ', {
      message: err.message,
      stack: err.stack,
      name: err.name,
      statusCode: err.statusCode,
      path: res.req?.originalUrl,
      method: res.req?.method,
      timestamp: new Date().toISOString()
    });

    // 2) Send generic message
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

// Error handling for rate limiting
export const handleRateLimit = (req, res) => {
  const err = new RateLimitError();
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    retryAfter: err.retryAfter,
  });
};

// Error handling for API quota exceeded
export const handleQuotaExceeded = (req, res, next) => {
  const err = new QuotaExceededError();
  next(err);
};

// Error handling for service unavailable
export const handleServiceUnavailable = (req, res, next) => {
  const err = new ServiceUnavailableError();
  next(err);
};

// Main error handler
export default (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err };
    error.message = err.message;

    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 23505) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);

    sendErrorProd(error, res);
  }
};
