import { Router, Request, Response, NextFunction } from 'express';
import { gradingService } from '../services/gradingService';
import { Submission } from '../models/Submission';
import { MarkerUser } from '../models/User';
import jwt from 'jsonwebtoken';
// import { authMiddleware } from '../middleware/authMiddleware'; // Uncomment when auth is ready

const router = Router();

// Middleware to get user from JWT (reuse from userRoutes)
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

// Middleware to check admin (reuse from userRoutes)
async function requireAdmin(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

// POST /api/submissions/grade
router.post('/grade', getUserFromToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { githubUrl, rubric, projectType, fileGlobs } = req.body;
    const userId = (req as any).user?._id?.toString() || (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    console.log('Received projectType from body:', projectType);
    const submission = new Submission({
      githubUrl,
      rubric,
      projectType,
      userId,
      status: 'uploading',
      grade: 'pending',
      metadata: {
        projectType,
        dependencies: [],
        testResults: { passed: 0, total: 0, details: '-', duration: 0 },
        aiAnalysis: { promptTokens: 0, completionTokens: 0, analysisTime: 0, modelUsed: 'mock' }
      }
    });
    await submission.save();

    console.log('[SUBMISSION RECEIVED]', { id: submission._id, projectType: (submission as any).metadata?.projectType });

    gradingService.gradeSubmission(submission, fileGlobs)
      .then(async (result) => {
        submission.status = 'completed';
        submission.grade = result.grade;
        submission.scores = result.scores;
        submission.report = result.report;
        console.log('[SUBMISSION GRADED]', {
          id: submission._id,
          scores: result.scores,
          grade: result.grade,
          report: result.report?.slice(0, 200) // Print first 200 chars only
        });
        await submission.save();
      })
      .catch(async (error) => {
        submission.status = 'failed';
        submission.error = error.message;
        await submission.save();
      });

    res.status(202).json({ submissionId: submission._id });
    return;
  } catch (error) {
    next(error);
    return;
  }
});

// GET /api/submissions (dashboard)
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId, status, limit = 50, skip = 0 } = req.query;
    const query: any = {};
    if (userId) query.userId = userId;
    if (status) query.status = status;
    const submissions = await Submission.find(query)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    // Get unique userIds
    const userIds = [...new Set(submissions.map((s: any) => s.userId))];
    const users = await MarkerUser.find({ _id: { $in: userIds } }, 'email');
    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u.email]));

    // Attach userEmail to each submission
    const submissionsWithEmail = submissions.map((s: any) => ({
      ...s.toObject(),
      userEmail: userMap[s.userId] || s.userId
    }));

    res.json(submissionsWithEmail);
    return;
  } catch (error) {
    next(error);
    return;
  }
});

// GET /api/submissions/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }
    // TODO: Add user/role check
    res.json(submission);
    return;
  } catch (error) {
    next(error);
    return;
  }
});

// GET /api/submissions/:id/report.md (download markdown report)
router.get('/:id/report.md', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission || !submission.report) {
      res.status(404).send('Report not found');
      return;
    }
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="submission-${submission._id}.md"`);
    res.send(submission.report);
    return;
  } catch (error) {
    next(error);
    return;
  }
});

// PATCH /api/submissions/:id - update submission (admin only)
router.patch('/:id', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, grade, error } = req.body;
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (status) submission.status = status;
    if (grade) submission.grade = grade;
    if (error) submission.error = error;
    await submission.save();
    return res.json(submission);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update submission' });
  }
});

// DELETE /api/submissions/:id - delete submission (admin only)
router.delete('/:id', getUserFromToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const submission = await Submission.findByIdAndDelete(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    return res.json({ message: 'Submission deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete submission' });
  }
});

export { router as submissionRouter }; 