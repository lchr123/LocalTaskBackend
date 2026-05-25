/**
 * Report Service - Business logic for report submission.
 *
 * Handles:
 * - Validating report payload
 * - Creating report records
 *
 * Business rules:
 * - targetType must be 'user' or 'task'
 * - type must be a valid report type enum
 * - description: 1-1000 characters
 * - imageUrls: optional, max 5 URLs
 *
 * Validates: Requirements 6.1, 6.2
 */

import { Report } from '../types/report';
import * as reportRepository from '../repositories/reportRepository';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

interface SubmitReportPayload {
  targetType: 'user' | 'task';
  targetId: string;
  type: string;
  description: string;
  imageUrls?: string[];
}

/**
 * Submit a report.
 *
 * Additional validation beyond Zod schema:
 * - imageUrls array must not exceed 5 items (also enforced by Zod, but double-checked here)
 *
 * @param reporterId - The ID of the user submitting the report
 * @param payload - The report data
 * @returns The created report record
 *
 * Validates: Requirements 6.1, 6.2
 */
export async function submitReport(
  reporterId: string,
  payload: SubmitReportPayload
): Promise<Report> {
  // Additional validation: imageUrls max 5
  if (payload.imageUrls && payload.imageUrls.length > 5) {
    throw new AppError(422, 'validation_error', '最多上传5张图片', {
      imageUrls: '最多上传5张图片',
    });
  }

  const report = await reportRepository.create(reporterId, payload);

  logger.info('Report submitted successfully', {
    reportId: report.id,
    reporterId,
    targetType: payload.targetType,
    targetId: payload.targetId,
    type: payload.type,
  });

  return report;
}
