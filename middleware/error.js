module.exports = (err, req, res, next) => {
    console.error(err.stack);
    
    // Default error status and message
    let status = err.status || 500;
    let message = err.message || 'Internal Server Error';

    if (err.errors && typeof err.errors === 'object') {
        status = err.status || 400;
        message = 'Validation error';
        return res.status(status).json({
          success: false,
          message,
          errors: err.errors
        });
    }
  
    // Mongoose validation error
    if (err.name === 'ValidationError') {
      status = 400;
      const errors = Object.values(err.errors).map(val => val.message);
      message = errors.join(', ');
    }
  
    // Mongoose duplicate key error
    if (err.code === 11000) {
      status = 400;
      const field = Object.keys(err.keyValue)[0];
      message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    }
  
    res.status(status).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  };