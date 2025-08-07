const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const postController = require('../controllers/postController');

router.post('/', auth, postController.createPost);
router.get('/', auth, postController.getPosts);
router.put('/:postId/like', auth, postController.toggleLike);
router.post('/:postId/comment', auth, postController.addComment);
router.get('/feed', auth, postController.getPersonalizedFeed);
router.get('/user/:userId', auth, postController.getPostsByUser);

module.exports = router;