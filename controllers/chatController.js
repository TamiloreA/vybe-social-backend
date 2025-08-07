
const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const Notification = require("../models/Notification");
const User = require("../models/User");
const mongoose = require("mongoose");
const webpush = require("web-push");

webpush.setVapidDetails(
  "mailto:tamiloreakinsola@gmail.com",
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

const rooms = new Map();    
const pushSubs = new Map();
const callPeers = new Map();

let io = null;
let isInitialized = false;
const typingUsers = new Map(); 

exports.setupSocket = (server) => {
  if (isInitialized) {
    console.log("Socket.IO already initialized");
    return;
  }

  io = require("socket.io")(server, {
    cors: {
      origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedPatterns.some(p => p.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["polling", "websocket"],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8,
  });
  
  io.engine.on("connection_error", (err) => {
    console.error("Engine connection error:", err);
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    console.log("🔍 socket auth token:", token);
    if (!token) {
      console.error("Socket auth: Missing token");
      return next(new Error("Authentication error"));
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.error("JWT verification failed:", err.message);
        return next(new Error("Authentication error"));
      }
      socket.userId = new mongoose.Types.ObjectId(decoded.userId);
      next();
    });
  });

  io.of("/").on("connection", (socket) => {
    console.log(
      "🔗 socket connected, id=",
      socket.id,
      "userId=",
      socket.userId
    );

    User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      lastSeen: new Date(),
      socketId: socket.id
    }).exec();

    socket.on("heartbeat", async () => {
      try {
        await User.findByIdAndUpdate(socket.userId, {
          lastSeen: new Date(),
        });
      } catch (err) {
        console.error("Heartbeat update error:", err);
      }
    });

    socket.join(socket.userId.toString());

    socket.on("register-push", (sub) => pushSubs.set(socket.userId.toString(), sub));

    socket.on("initiate-call", async ({ calleeId, type }) => {
      const callerId = socket.userId.toString();
      const roomId = [callerId, calleeId].sort().join('-');
      
      rooms.set(roomId, {
        roomId,
        callerId,
        calleeId,
        type,
        status: "ringing",
        participants: [callerId] 
      });
    
      const caller = await User.findById(callerId).select("fullName profilePic");
      
      socket.emit("call-initiated", { roomId, type });
      
      io.to(calleeId).emit("incoming-call", { roomId, caller, type });
      
      setTimeout(() => {
        if (rooms.get(roomId)?.status === "ringing") {
          endCall(roomId, "no-answer");
        }
      }, 30000);
    });
    
    socket.on("accept-call", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      
      room.status = "ongoing";
      room.participants.push(room.calleeId);
      rooms.set(roomId, room);
      
      io.to(room.callerId).emit("call-accepted", roomId);
      io.to(room.calleeId).emit("call-accepted", roomId);
    });
    
    socket.on("decline-call", ({ roomId }) => {
      endCall(roomId, "declined");
    });
    
    socket.on("end-call", ({ roomId }) => {
      endCall(roomId, "ended");
    });
    
    socket.on("webrtc-signal", ({ roomId, signal, senderId }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      
      const targetId = room.participants.find(id => id !== senderId);
      
      if (targetId) {
        console.log(`Forwarding signal from ${senderId} to ${targetId}`);
        if (room.status === "ongoing") {
          io.to(targetId).emit("webrtc-signal", { 
            signal, 
            roomId,
            senderId 
          });
        }
      }
    });
    
    function endCall(roomId, reason) {
      const room = rooms.get(roomId);
      if (!room) return;
      
      room.participants.forEach(participantId => {
        io.to(participantId).emit("call-ended", { reason, roomId });
      });
      
      rooms.delete(roomId);
    }

    socket.on("join-call-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.userId} joined call room ${roomId}`);
    });

    socket.on("join", (userId) => {
      const roomId = new mongoose.Types.ObjectId(userId).toString();
      socket.join(roomId);
      console.log(`User ${socket.userId} joined room ${roomId}`);
    });

    socket.on("send_notification", async (data) => {
      try {
        if (!data.receiverId) {
          console.error("Missing receiverId in notification");
          return;
        }

        const notif = new Notification({
          receiver: new mongoose.Types.ObjectId(data.receiverId),
          sender: socket.userId,
          type: data.type,
          post: data.postId ? new mongoose.Types.ObjectId(data.postId) : null,
          content: data.commentText,
        });

        const saved = await notif.save();

        const populatedNotif = await Notification.findById(saved._id)
          .populate("sender", "username profilePic")
          .populate({
            path: "post",
            select: "image",
          })
          .lean();

        io.to(data.receiverId.toString()).emit(
          "new_notification",
          populatedNotif
        );
      } catch (err) {
        console.error("Notification error:", err);
      }
    });

    let activeConversation = null;

    // Join conversation room
    socket.on("join_conversation", (conversationId) => {
      if (activeConversation) {
        socket.leave(activeConversation);
      }
      activeConversation = conversationId;
      socket.join(conversationId);
      console.log(`User ${socket.userId} joined conversation ${conversationId}`);
    });

    // Typing indicators
    socket.on("typing", (conversationId) => {
      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }
      typingUsers.get(conversationId).add(socket.userId.toString());
      
      // Broadcast to other conversation participants
      socket.to(conversationId).emit("user_typing");
    });

    socket.on("stop_typing", (conversationId) => {
      if (typingUsers.has(conversationId)) {
        typingUsers.get(conversationId).delete(socket.userId.toString());
        
        // Broadcast to other conversation participants
        socket.to(conversationId).emit("user_stop_typing");
      }
    });

    // Mark message as read
    socket.on("mark_message_read", async (data) => {
      try {
        const { messageId, conversationId } = data;
        
        // Update message as read
        await Message.findByIdAndUpdate(messageId, {
          $addToSet: { readBy: socket.userId },
          read: true
        });
        
        // Emit update to all conversation participants
        const updatedMessage = await Message.findById(messageId)
          .populate("sender", "username profilePic");
          
        io.to(conversationId).emit("message_read", {
          messageId,
          readBy: updatedMessage.readBy
        });
        
        // Update conversation unread count
        const conversation = await Conversation.findById(conversationId);
        if (conversation.unreadCount > 0) {
          conversation.unreadCount -= 1;
          await conversation.save();
          
          // Emit conversation update
          const updatedConv = await Conversation.findById(conversationId)
            .populate("participants", "username profilePic fullName isOnline lastSeen")
            .populate("lastMessage", "content createdAt");
            
          updatedConv.participants.forEach(participant => {
            io.to(participant._id.toString()).emit("conversation_updated", updatedConv);
          });
        }
      } catch (err) {
        console.error("Error marking message as read:", err);
      }
    });

    // Mark conversation as read
    socket.on("mark_conversation_read", async (conversationId) => {
      try {
        // Mark all messages as read for this user
        await Message.updateMany(
          {
            conversation: conversationId,
            sender: { $ne: socket.userId },
            readBy: { $ne: socket.userId }
          },
          {
            $addToSet: { readBy: socket.userId },
            $set: { read: true }
          }
        );
        
        // Reset unread count
        await Conversation.findByIdAndUpdate(conversationId, {
          unreadCount: 0
        });
        
        // Emit conversation update
        const updatedConv = await Conversation.findById(conversationId)
          .populate("participants", "username profilePic fullName isOnline lastSeen")
          .populate("lastMessage", "content createdAt");
          
        updatedConv.participants.forEach(participant => {
          io.to(participant._id.toString()).emit("conversation_updated", updatedConv);
        });
      } catch (err) {
        console.error("Error marking conversation as read:", err);
      }
    });

    socket.on("send_message", async (data, callback) => {
      const session = await mongoose.startSession();
      session.startTransaction();
    
      let committed = false;
    
      try {
        if (!data.conversation || !data.content) {
          throw new Error("Invalid message data");
        }
    
        const message = new Message({
          conversation: new mongoose.Types.ObjectId(data.conversation),
          sender: socket.userId,
          content: data.content,
          readBy: [socket.userId] // Sender has read the message
        });
    
        const savedMessage = await message.save({ session });
    
        await Conversation.findByIdAndUpdate(
          data.conversation,
          {
            lastMessage: savedMessage._id,
            $inc: { unreadCount: 1 },
            updatedAt: new Date(),
          },
          { session }
        );
    
        await session.commitTransaction();
        committed = true;
    
        const populatedMessage = await Message.findById(savedMessage._id)
          .populate("sender", "username profilePic")
          .lean();
    
        // Broadcast message to conversation room
        io.to(data.conversation).emit("receive_message", populatedMessage);
    
        const conversation = await Conversation.findById(data.conversation);
        const receiverId = conversation.participants.find(
          (id) => !id.equals(socket.userId)
        );
    
        if (receiverId) {
          const notif = new Notification({
            receiver: receiverId,
            sender: socket.userId,
            type: "message",
            content: `"${data.content.substring(0, 20)}..."`,
            conversation: data.conversation,
          });
    
          await notif.save();
          io.to(receiverId.toString()).emit("new_notification", notif);
        }
    
        // Update conversation in real-time
        const updatedConversation = await Conversation.findById(data.conversation)
          .populate("participants", "username profilePic fullName isOnline lastSeen")
          .populate("lastMessage", "content createdAt")
          .lean();
    
        // Broadcast conversation update
        updatedConversation.participants.forEach(participant => {
          io.to(participant._id.toString()).emit("conversation_updated", updatedConversation);
        });
    
        callback({ status: "success", message: savedMessage });
      } catch (err) {
        if (!committed) {
          await session.abortTransaction();
        }
        console.error("❌ send_message error:", err);
        callback({ status: "error", error: err.message });
      } finally {
        session.endSession();
      }
    });

    socket.on("disconnect", async (reason) => {
      console.log(`❌ Client disconnected (${reason}):`, socket.userId);
      
      try {
        await User.findByIdAndUpdate(socket.userId, {
          isOnline: false,
          lastSeen: new Date(),
          $unset: { socketId: 1 }
        });
      } catch (err) {
        console.error('Disconnect update error:', err);
      }
      
      socket.leave(socket.userId.toString());
      
      // Clear typing status
      typingUsers.forEach((users, conversationId) => {
        if (users.has(socket.userId.toString())) {
          users.delete(socket.userId.toString());
          io.to(conversationId).emit("user_stop_typing");
        }
      });
      
      // End any active calls
      rooms.forEach((room, roomId) => {
        if (room.participants.includes(socket.userId.toString())) {
          endCall(roomId, "disconnected");
        }
      });
    });
  });

  isInitialized = true;
  console.log("Socket.IO initialized successfully with call support");
  return io;
};

// REST endpoints
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user,
    })
      .populate({
        path: "participants",
        select: "username profilePic fullName isOnline lastSeen socketId",
      })
      .populate({
        path: "lastMessage",
        select: "content createdAt",
      })
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

exports.getConversation = async (req, res) => {
  try {
    const messages = await Message.find({
      conversation: req.params.conversationId,
    })
      .populate("sender", "username profilePic")
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
};

exports.startConversation = async (req, res) => {
  const { userId } = req.params;

  let conversation = await Conversation.findOne({
    participants: { $all: [req.user, userId] },
  });

  if (!conversation) {
    conversation = new Conversation({
      participants: [req.user, userId],
      unreadCount: 0,
    });
    await conversation.save();
  }

  res.json({ _id: conversation._id });
};

exports.markConversationRead = async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    
    // Mark all messages as read for this user
    await Message.updateMany(
      {
        conversation: conversationId,
        sender: { $ne: req.user._id },
        readBy: { $ne: req.user._id }
      },
      {
        $addToSet: { readBy: req.user._id },
        $set: { read: true }
      }
    );
    
    // Reset unread count
    await Conversation.findByIdAndUpdate(conversationId, {
      unreadCount: 0
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking conversation as read:", err);
    res.status(500).json({ error: "Server error" });
  }
};
