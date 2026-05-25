export type IntentStatus = 'pending' | 'selected' | 'rejected' | 'withdrawn';

export interface Intent {
  id: string;
  taskId: string;
  helperId: string;
  helperNickname: string;
  helperRating: number;
  helperCompletedCount: number;
  message?: string;
  status: IntentStatus;
  createdAt: string;
}
