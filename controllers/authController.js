const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose'); 
const User = require('../models/User');

// Password validation function
const validatePassword = (password) => {
  const requirements = [
    { test: p => p.length >= 8, msg: "At least 8 characters" },
    { test: p => /[A-Z]/.test(p), msg: "One uppercase letter" },
    { test: p => /[a-z]/.test(p), msg: "One lowercase letter" },
    { test: p => /\d/.test(p), msg: "One number" },
    { test: p => /[!@#$%^&*(),.?":{}|<>]/.test(p), msg: "One special character" }
  ];

  return requirements
    .filter(req => !req.test(password))
    .map(req => req.msg);
};

const generateToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// @route   POST /api/auth/signup
exports.signup = async (req, res) => {
  const { fullName, username, email, password } = req.body;

  try {
    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ errors: { email: 'User already exists' } });
    }

    // Check username
    user = await User.findOne({ username });
    if (user) {
      return res.status(400).json({ errors: { username: 'Username is already taken' } });
    }

    // Validate password
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ errors: { password: passwordErrors } });
    }

    // Create new user
    user = new User({ fullName, username, email, password });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    // Generate token using centralized function
    const token = generateToken(user._id);

    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.status(201).json({
      _id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      profilePic: user.profilePic,
      token
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ errors: { server: 'Server error' } });
  }
};

// @route   POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check for user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ errors: { email: 'Invalid credentials' } });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ errors: { password: 'Invalid credentials' } });
    }

    // Generate token using centralized function
    const token = generateToken(user._id);
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 604800000, // 7 days
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.json({
      success: true,
      user: {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        profilePic: user.profilePic
      },
      token
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ errors: { server: 'Server error' } });
  }
};

// @route   POST /api/auth/logout
exports.logout = (req, res) => {
  res.clearCookie('token');
  res.json({ msg: 'Logged out successfully' });
};

// @route   GET /api/auth/me
exports.getCurrentUser = async (req, res) => {
  try {
    console.log('Fetching user for ID:', req.user.toString());
    
    const user = await User.findById(req.user).select('-password');
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (err) {
    console.error('Get current user error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      code: 'SERVER_ERROR'
    });
  }
};

// @route   POST /api/auth/refresh
exports.refreshToken = async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token required' });
    }

    // Verify token without expiration check
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    
    // Check if user exists
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Generate new token
    const newToken = jwt.sign(
      { userId: user.id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set new cookie
    res.cookie('token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 604800000, // 7 days
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.json({
      success: true,
      token: newToken
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};