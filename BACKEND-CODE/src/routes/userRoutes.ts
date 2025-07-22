import { Router, Request, Response } from 'express';
import { MarkerUser } from '../models/User';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const router = Router();

// Middleware to get user from JWT
async function getUserFromToken(req: Request, res: Response, next: Function) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token' });
    }
    const token = auth.slice(7);
    const jwtSecret = process.env.JWT_SECRET as string;
    const payload = jwt.verify(token, jwtSecret) as any;
    const user = await MarkerUser.findById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    (req as any).user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware to check admin
async function requireAdmin(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

// GET /api/users - list all users (admin only)
router.get('/', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await MarkerUser.find({}, '-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users - create user (admin only)
router.post('/', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, password, role, name } = req.body;
    if (!email || !password || !role || !name) return res.status(400).json({ error: 'Missing required fields' });
    const existing = await MarkerUser.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already in use' });
    const newUser = await MarkerUser.create({ email, password, role, profile: { name } });
    return res.status(201).json({ id: newUser._id, email: newUser.email, role: newUser.role, profile: newUser.profile });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET /api/users/:id - get user by ID (admin only)
router.get('/:id', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = await MarkerUser.findById(req.params.id, '-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/users/:id - update user (admin only)
router.patch('/:id', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { role, name } = req.body;
    const user = await MarkerUser.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (role) user.role = role;
    if (name) user.profile.name = name;
    await user.save();
    return res.json({ id: user._id, email: user.email, role: user.role, profile: user.profile });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id - delete user (admin only)
router.delete('/:id', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = await MarkerUser.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// PATCH /api/users/me - update profile
router.patch('/me', getUserFromToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name } = req.body;
    if (name) user.profile.name = name;
    await user.save();
    res.json({ id: user._id, email: user.email, role: user.role, profile: user.profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/users/me/change-password
router.post('/me/change-password', getUserFromToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Old and new password required' });
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Old password is incorrect' });
    user.password = newPassword;
    await user.save();
    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

export { router as userRouter }; 