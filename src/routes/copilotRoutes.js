const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { handleCopilotChat } = require('../controllers/copilotController');

router.post('/chat', protect, handleCopilotChat);

module.exports = router;
