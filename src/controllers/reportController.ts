import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createReportSchema } from '../validators/reportValidator';
import * as reportService from '../services/reportService';
import * as reportRepository from '../repositories/reportRepository';
import { AuthenticatedRequest } from '../types/common';

const router = Router();

/**
 * POST /reports
 * Submit a report. Requires authentication.
 * Request body is validated using createReportSchema via the validate middleware.
 *
 * Validates: Requirements 6.1, 6.2
 */
router.post(
  '/',
  authMiddleware as any,
  validate(createReportSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const report = await reportService.submitReport(authReq.user!.userId, req.body);
      res.status(201).json(report);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /reports/mine
 * Fetch all reports submitted by the current user.
 * Requires authentication.
 */
router.get(
  '/mine',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const reports = await reportRepository.findByReporterId(authReq.user!.userId);
      res.json({ reports });
    } catch (err) {
      next(err);
    }
  }
);

export { router as reportController };
