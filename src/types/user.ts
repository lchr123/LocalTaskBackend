export interface User {
  id: string;
  cognitoSub: string;
  email: string;
  phone?: string;
  nickname?: string;
  avatarUrl?: string;
  averageRating: number;
  completedTaskCount: number;
  createdAt: string;
  updatedAt: string;
}
