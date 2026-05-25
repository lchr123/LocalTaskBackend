export type ReportType = 'fake_task' | 'harassment' | 'fraud' | 'inappropriate_content' | 'other';

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'user' | 'task';
  targetId: string;
  type: ReportType;
  description: string;
  imageUrls: string[];
  status: 'submitted' | 'reviewing' | 'resolved';
  createdAt: string;
}
