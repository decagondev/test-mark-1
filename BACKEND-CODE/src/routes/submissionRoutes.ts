import { Router, Request, Response } from 'express';

const router = Router();

// Placeholder routes - will be implemented in Phase 1
router.post('/grade', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented yet',
    endpoint: 'POST /api/submissions/grade',
    message: 'Grading functionality will be implemented in Phase 1'
  });
});

router.get('/:id', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented yet',
    endpoint: 'GET /api/submissions/:id',
    message: 'Submission status checking will be implemented in Phase 1'
  });
});

router.get('/', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented yet',
    endpoint: 'GET /api/submissions',
    message: 'Submission listing will be implemented in Phase 1'
  });
});

export { router as submissionRouter }; 