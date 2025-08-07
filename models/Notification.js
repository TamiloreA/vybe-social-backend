// models/Notification.js
const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

const notificationSchema = new Schema({
  receiver: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Receiver is required']
  },
  sender: {             
    type: ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,  
    enum: ['like', 'comment', 'follow', 'message'],
    required: true
  },
  post: {              
    type: ObjectId,
    ref: 'Post'
  },
  content: String,     
  createdAt: {
    type: Date,
    default: Date.now
  },
  read: {
    type: Boolean,  
    default: false
  }
});

module.exports = model('Notification', notificationSchema);