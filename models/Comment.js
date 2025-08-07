const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
  },
  content: {
    type: String,
    required: [true, 'Comment content is required'],
    maxlength: [500, 'Comment cannot be longer than 500 characters'],
  },
}, { timestamps: true });

module.exports = mongoose.model('Comment', CommentSchema);