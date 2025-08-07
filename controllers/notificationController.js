const Notification = require("../models/Notification");


exports.getNotifications = async (req, res) => {
  try {
    // Check if req.user is set
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    console.log("Fetching notifications for user:", req.user.toString());
    
    const notifs = await Notification.find({ receiver: req.user })
      .populate({
        path: "sender",
        select: "username profilePic"
      })
      .populate({
        path: "post",
        select: "image"
      })
      .sort({ createdAt: -1 });
    
    console.log("Fetched notifications:", notifs.length);
    res.json(notifs);
  } catch (err) {
    console.error("getNotifications error", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, receiver: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: "Not found" });
    res.json(notif);
  } catch (err) {
    console.error("markAsRead error", err);
    res.status(500).json({ message: "Server error" });
  }
};
