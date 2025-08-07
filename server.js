require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const connectDB = require('./config/db');
const http = require('http');
const { setupSocket } = require('./controllers/chatController');

const app = express();
const server = http.createServer(app);

// Database connection
connectDB();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const allowedOrigins = [
   'https://vybe-social-media-4jtt.vercel.app',
  'https://vybe-social-media.vercel.app', 
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

const allowedPatterns = [
  /^https:\/\/vybe-social-media-[a-z0-9]+\.vercel\.app$/, 
  /^https:\/\/vybe-social-media-[a-z0-9]+-[a-z0-9]+\.vercel\.app$/
];

app.use(cors({
    origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (allowedPatterns.some(pattern => pattern.test(origin))) {
      callback(null, true);
    } else {
      console.log(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

// Setup Socket.IO and get the instance
const io = setupSocket(server);

// Make io accessible in routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

// Error handling middleware
app.use(require('./middleware/error'));

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
