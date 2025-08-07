const mongoose = require('mongoose');
const User = require('../models/User'); 
const Notification = require('../models/Notification');

exports.completeOnboarding = async (req, res) => {
    try {
      const userId = req.user            
      const { followedUserIds } = req.body
  
      
      await User.findByIdAndUpdate(userId, {
        $addToSet: { following: { $each: followedUserIds } },
        $inc:     { followingCount: followedUserIds.length },
        onboardingComplete: true,
      })
  
      
      await User.updateMany(
        { _id: { $in: followedUserIds } },
        {
          $addToSet: { followers: userId },
          $inc:      { followersCount: 1 }
        }
      )
  
      return res.json({ success: true })
    } catch (err) {
      console.error("Onboarding error:", err)
      return res.status(500).json({ error: "Could not complete onboarding" })
    }
}

exports.followUser = async (req, res) => {
  try {
    const userId = req.user;
    const { targetUserId } = req.body;

    // Validate input
    if (!mongoose.Types.ObjectId.isValid(userId)){
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'Invalid target user ID' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      const targetUser = await User.findById(targetUserId).session(session);

      if (!user || !targetUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ msg: 'User not found' });
      }

      // Convert to string for proper comparison
      const isFollowing = user.following.some(id => 
        id.toString() === targetUserId.toString()
      );

      if (isFollowing) {
        // Unfollow
        user.following.pull(new mongoose.Types.ObjectId(targetUserId));
        user.followingCount = user.following.length;
        
        targetUser.followers.pull(new mongoose.Types.ObjectId(userId));
        targetUser.followersCount = targetUser.followers.length;
      } else {
        // Follow
        user.following.push(new mongoose.Types.ObjectId(targetUserId));
        user.followingCount = user.following.length;
        
        targetUser.followers.push(new mongoose.Types.ObjectId(userId));
        targetUser.followersCount = targetUser.followers.length;

        // Create notification
        const notification = new Notification({
          receiver: targetUserId,
          type: 'follow',
          sender: userId
        });
        await notification.save({ session });
      }

      await user.save({ session });
      await targetUser.save({ session });
      await session.commitTransaction();
      session.endSession();

      res.json({ 
        success: true,
        isFollowing: !isFollowing
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Transaction error:', error);
      throw error;
    }
  } catch (err) {
    console.error('Follow error:', err);
    res.status(500).json({ 
      error: 'Server error',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "-password -blockedUsers -isNewUser"
    );
    if (!user) return res.status(404).json({ msg: "User not found" });

    const me = await User.findById(req.user).select("following");
    res.json({
      ...user.toObject(),
      isFollowing: me.following.includes(user._id),
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  };
};

exports.getSuggestedUsers = async (req, res) => {
    try {
      const userId = req.user;
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }
      
      const suggestedUsers = await User.aggregate([
        { 
          $match: { 
            _id: { 
              $ne: new mongoose.Types.ObjectId(userId), 
              $nin: user.following.map(id => new mongoose.Types.ObjectId(id))
            } 
          }
        },
        { $sample: { size: 10 } },
        { $project: { 
            _id: 1,
            username: 1,
            profilePic: 1,
            fullName: 1,
            followersCount: { $size: "$followers" }
          }
        }
      ]);
      
      res.json(suggestedUsers);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
};

exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user;
    
    if (String(currentUserId) !== String(userId)) {
      return res.status(403).json({ message: 'You are not authorized to update this user' });
    }

    const updateData = { ...req.body };
    
    delete updateData.password;
    delete updateData.email;
    delete updateData.role;

    if (updateData.profilePic) {
      if (!/^\/uploads\/.+$/.test(updateData.profilePic)) {
        return res.status(400).json({ message: 'Invalid profile picture URL' });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.searchUsers = async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.status(400).json([]);

  const users = await User.find({
    $or: [
      { username: { $regex: q, $options: "i" } },
      { fullName: { $regex: q, $options: "i" } },
    ],
    _id: { $ne: req.user },
  })
    .select("-password")
    .limit(20);

  const current = await User.findById(req.user).select("following");
  const enriched = users.map((u) => ({
    ...u.toObject(),
    isFollowing: current.following.includes(u._id),
  }));

  res.json(enriched);
};