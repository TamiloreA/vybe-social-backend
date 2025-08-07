const Post = require('../models/Post');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');

exports.createPost = async (req, res) => {
  try {
    const { content, image } = req.body;
    
    const newPost = new Post({
      user: req.user,
      content,
      image
    });

    const post = await newPost.save();
    res.status(201).json(post);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .populate('user', 'username profilePic')
      .populate('likes', 'username profilePic')
      .populate({
        path: 'comments',
        populate: {
          path: 'user',
          select: 'username profilePic'
        }
      });
      
    res.json(posts);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    console.log('Full request params:', req.params);
    console.log('Authenticated user:', req.user);
    
    if (!req.params.postId) {
      return res.status(400).json({ 
        success: false,
        message: "Post ID is required",
        code: "MISSING_POST_ID"
      });
    }

    // FIXED: Changed from req.user?._id to just req.user
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: "User not authenticated",
        code: "UNAUTHORIZED"
      });
    }

    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: "Post not found",
        code: "POST_NOT_FOUND",
        receivedId: req.params.postId
      });
    }

    // FIXED: Changed from req.user._id to just req.user
    const hasLiked = post.likes.includes(req.user);
    if (hasLiked) {
      post.likes.pull(req.user); // FIXED: Changed to req.user
    } else {
      post.likes.push(req.user); // FIXED: Changed to req.user
    }

    await post.save();

    const io = req.io;
    
    if (io) {
      io.emit('like_update', {
        postId: post._id,
        likes: post.likes
      });
    } else {
      console.error("Socket.io instance not available");
    }

    if (!hasLiked && post.user.toString() !== req.user.toString()) {
      const notification = new Notification({
        receiver: post.user,
        type: 'like',
        sender: req.user,
        post: post._id
      });
      
      try {
        const saved = await notification.save();
        // Emit notification if socket available
        if (io) {
          io.to(post.user.toString()).emit('new_notification', {
            ...saved.toObject(),
            sender: req.user // Simplified for now
          });
        }
      } catch (err) {
        console.error("Notification save error:", err);
      }
    }

    res.json({
      success: true,
      likes: post.likes,
      hasLiked: !hasLiked
    });
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      code: "SERVER_ERROR"
    });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { content } = req.body;
    const postId = req.params.id;
    
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }

    const newComment = new Comment({
      user: req.user,
      post: post._id,
      content
    });

    const comment = await newComment.save();
    post.comments.push(comment._id);
    await post.save();
    
    if (post.user.toString() !== req.user.toString()) {
      console.log("Creating comment notification");
      const notification = new Notification({
        receiver: post.user,
        type: 'comment',
        sender: req.user,
        post: post._id,
        content: content
      });
      
      try {
        await notification.save();
        console.log("Comment notification saved:", notification);
      } catch (err) {
        console.error("Error saving comment notification:", err);
      }
    }

    // Populate user info in the comment
    await comment.populate('user', 'username profilePic');

    res.json(comment);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
};

exports.getPostsByUser = async (req, res) => {
    try {
      const posts = await Post.find({ user: req.params.userId })
        .sort({ createdAt: -1 })
        .populate('user', 'username profilePic fullName')
        .populate('likes', 'username profilePic')
        .populate({
          path: 'comments',
          populate: {
            path: 'user',
            select: 'username profilePic'
          }
        });
        
      res.json(posts);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ msg: 'Server error' });
    }
};

exports.getPersonalizedFeed = async (req, res) => {
    try {
      const userId = req.user;
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;
  
      const user = await User.findById(userId).populate('following');
      
      // Get posts from followed users
      const followedPosts = await Post.find({ 
        user: { $in: user.following.map(u => u._id) }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'username profilePic fullName')
      .populate('likes', 'username profilePic')
      .populate({
        path: 'comments',
        populate: {
          path: 'user',
          select: 'username profilePic'
        }
      });
  
      res.json(followedPosts);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
};