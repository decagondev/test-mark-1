import { Router } from 'express';
import { MarkerUser } from '../models/User';
import jwt from 'jsonwebtoken';

const router = Router();

function generateToken(user: any) {
  const jwtSecret = process.env.JWT_SECRET as string;
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(
    { userId: user._id, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn } as jwt.SignOptions
  );
}

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const existing = await MarkerUser.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already in use' });
    const newUser = await MarkerUser.create({ email, password, profile: { name } });
    const token = generateToken(newUser);
    return res.json({ token, user: { id: newUser._id, email: newUser.email, role: newUser.role, profile: newUser.profile } });
  } catch (err) {
    next(err);
    return;
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await MarkerUser.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const bcrypt = require('bcrypt');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken(user);
    return res.json({ token, user: { id: user._id, email: user.email, role: user.role, profile: user.profile } });
  } catch (err) {
    next(err);
    return;
  }
});

// GET /api/auth/me
router.get('/me', async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    const token = auth.slice(7);
    const jwtSecret = process.env.JWT_SECRET as string;
    const payload = jwt.verify(token, jwtSecret) as any;
    const user = await MarkerUser.findById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    return res.json({ id: user._id, email: user.email, role: user.role, profile: user.profile });
  } catch (err) {
    next(err);
    return;
  }
});

export { router as authRouter }; 