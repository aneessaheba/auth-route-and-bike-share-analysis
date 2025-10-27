require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const verifyToken = require('./auth');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '1h';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    let user = await User.findOne({ username });
    if (user) {
      return res.status(409).json({ message: 'User already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    user = new User({ username, password: hashedPassword, role: role || 'user' });

    await user.save();

    res.status(201).json({ message: 'User registered successfully.', username: user.username, role: user.role });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error during registration.' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ message: 'Authentication failed: Invalid credentials.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Authentication failed: Invalid credentials.' });
    }

    const payload = { id: user._id, username: user.username, role: user.role };

    jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY }, (err, token) => {
      if (err) throw err;

      res.json({ message: 'Login successful.', token: token, expiresIn: TOKEN_EXPIRY });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error during login.' });
  }
});

router.get('/protected/admin-data', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: "Access Denied: Requires 'admin' role.", userRole: req.user.role });
  }

  res.json({
    message: "SUCCESS! You accessed the highly protected admin resource.",
    data: { sensitiveInfo: `Welcome, ${req.user.username}. You are authorized as '${req.user.role}'.`, verifiedClaims: req.user }
  });
});

router.get('/protected/user-status', verifyToken, (req, res) => {
  const role = req.user && req.user.role;

  if (!role || (role !== 'admin' && role !== 'user')) {
    return res.status(403).json({ message: "Access Denied: Requires 'user' or 'admin' role.", userRole: role || null });
  }

  return res.status(200).json({ message: `Access granted to '${req.user.username}' with role '${req.user.role}'.`, user: { username: req.user.username, role: req.user.role } });
});

module.exports = router;
