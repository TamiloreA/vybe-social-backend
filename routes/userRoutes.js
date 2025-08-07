const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const userController = require('../controllers/userController');

router.post('/onboarding', auth, userController.completeOnboarding);
router.post('/follow', auth, userController.followUser);
router.get('/suggested', auth, userController.getSuggestedUsers);
router.get('/search', auth, userController.searchUsers);
router.get('/:userId', auth, userController.getUser);
router.put('/:id', auth, userController.updateUser);

module.exports = router;