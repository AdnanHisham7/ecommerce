const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Handle 404 Not Found
 */
const notFound = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.originalUrl}`));
};

/**
 * Convert mongoose/third-party errors to ApiError
 */
const normalizeError = (err, req, res, next) => {
  let error = err;

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${err.path}: ${err.value}`);
  }
  // Mongoose ValidationError
  else if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    error = ApiError.badRequest('Validation error', errors);
  }
  // Mongoose Duplicate key
  else if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = ApiError.conflict(`${field.charAt(0).toUpperCase() + field.slice(1)} already exists`);
  }
  // JWT errors
  else if (err.name === 'JsonWebTokenError') {
    error = ApiError.unauthorized('Invalid token');
  } else if (err.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Token expired');
  }
  // Multer errors
  else if (err.code === 'LIMIT_FILE_SIZE') {
    error = ApiError.badRequest('File size too large');
  }

  next(error);
};

/**
 * Global error handler
 */
const globalErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  if (!isOperational) {
    logger.error(`[${req.method}] ${req.path} - ${err.message}`, { stack: err.stack });
  } else {
    logger.warn(`[${req.method}] ${req.path} - ${err.message}`);
  }

  // Check if API request
  const isApiRequest = req.xhr || req.headers['content-type'] === 'application/json' || req.path.startsWith('/api/');

  if (isApiRequest) {
    return res.status(statusCode).json({
      success: false,
      status: err.status || 'error',
      message: err.message || 'Something went wrong',
      errors: err.errors || [],
      ...(env.isDev && { stack: err.stack }),
    });
  }

  // For web requests, render error page
  const message = statusCode === 500 && !env.isDev ? 'Something went wrong. Please try again.' : err.message;

  try {
    return res.status(statusCode).render('errors/error', {
      title: `${statusCode} Error`,
      statusCode,
      message,
      stack: env.isDev ? err.stack : null,
      currentUser: req.user || null,
    });
  } catch {
    return res.status(statusCode).send(`<h1>Error ${statusCode}</h1><p>${message}</p>`);
  }
};

module.exports = { notFound, normalizeError, globalErrorHandler };
