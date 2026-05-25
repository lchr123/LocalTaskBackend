import { query } from '../config/database';
import { Report } from '../types/report';

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: 'user' | 'task';
  target_id: string;
  type: string;
  description: string;
  image_urls: string[];
  status: string;
  created_at: string;
}

function mapRowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type,
    targetId: row.target_id,
    type: row.type as Report['type'],
    description: row.description,
    imageUrls: row.image_urls || [],
    status: row.status as Report['status'],
    createdAt: row.created_at,
  };
}

/**
 * Create a new report record.
 *
 * Validates: Requirements 6.1, 6.2
 */
export async function create(
  reporterId: string,
  payload: {
    targetType: 'user' | 'task';
    targetId: string;
    type: string;
    description: string;
    imageUrls?: string[];
  }
): Promise<Report> {
  const sql = `
    INSERT INTO reports (reporter_id, target_type, target_id, type, description, image_urls)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, reporter_id, target_type, target_id, type, description, image_urls, status, created_at
  `;

  const values = [
    reporterId,
    payload.targetType,
    payload.targetId,
    payload.type,
    payload.description,
    payload.imageUrls || [],
  ];

  const result = await query<ReportRow>(sql, values);
  return mapRowToReport(result.rows[0]);
}
