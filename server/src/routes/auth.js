import { Router } from 'express';
import { createUser, getUserByEmail, verifyPassword, createToken, verifyToken, getUserById } from '../auth.js';

const router = Router();

router.post('/signup', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  try {
    const user = createUser(email, password, name);
    const token = createToken(user.id, user.workspace);
    res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name, workspace: user.workspace } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = getUserByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'No account with that email yet', code: 'NO_ACCOUNT' });
  }
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = createToken(user.id, user.workspace);
  res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name, workspace: user.workspace } });
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const decoded = verifyToken(auth.slice(7));
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = getUserById(decoded.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({ ok: true, user });
});

export default router;
