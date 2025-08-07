const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const auth = require('../middleware/auth');

router.get('/conversations', auth, chatController.getConversations);
router.get('/conversations/:conversationId', auth, chatController.getConversation);
router.post('/start/:userId', auth, chatController.startConversation);
router.patch('/:conversationId/read', auth, chatController.markConversationRead);

module.exports = router;