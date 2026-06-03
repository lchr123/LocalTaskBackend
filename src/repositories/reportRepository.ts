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

/**
 * Find all reports submitted by a user, ordered by created_at DESC.
 * JOINs tasks/users to get the target name for display.
 */
export async function findByReporterId(reporterId: string): Promise<(Report & { targetName?: string })[]> {
  const sql = `
    SELECT
      r.id, r.reporter_id, r.target_type, r.target_id,
      r.type, r.description, r.image_urls, r.status, r.created_at,
      CASE
        WHEN r.target_type = 'task' THEN LEFT(t.description, 30)
        WHEN r.target_type = 'user' THEN u_target.nickname
        ELSE NULL
      END AS target_name
    FROM reports r
    LEFT JOIN tasks t ON r.target_type = 'task' AND r.target_id = t.id
    LEFT JOIN users u_target ON r.target_type = 'user' AND r.target_id = u_target.id
    WHERE r.reporter_id = $1
    ORDER BY r.created_at DESC
  `;

  const result = await query<ReportRow & { target_name?: string }>(sql, [reporterId]);
  return result.rows.map((row) => ({
    ...mapRowToReport(row),
    targetName: row.target_name ?? undefined,
  }));
}
