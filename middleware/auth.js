const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

module.exports = (req, res, next) => {
  // 1. Get token from multiple sources
  let token = req.cookies.token;
  
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token && req.query.token) {
    token = req.query.token;
  }

  // 2. Validate token existence
  if (!token) {
    console.log('No token found in request');
    return res.status(401).json({ 
      success: false,
      message: 'Authorization token required',
      code: 'AUTH_TOKEN_REQUIRED'
    });
  }

  try {
    // 3. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    // 4. Ensure valid user ID format
    if (!decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
      console.log('Invalid user ID in token:', decoded.userId);
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token format',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }

    // 5. Attach user to request
    req.user = new mongoose.Types.ObjectId(decoded.userId);
    console.log('Authenticated user ID:', req.user.toString());
    next();
  } catch (err) {
    console.error('Token verification error:', {
      message: err.message,
      name: err.name,
      token: token, // Log the problematic token
      stack: err.stack
    });
    
    // 6. Handle specific JWT errors
    let message = 'Token is not valid';
    if (err.name === 'TokenExpiredError') {
      message = 'Token has expired';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Invalid token format';
    }
    
    res.status(401).json({ 
      success: false,
      message,
      code: 'INVALID_TOKEN'
    });
  }
};