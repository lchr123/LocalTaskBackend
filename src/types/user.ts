export interface User {
  id: string;
  cognitoSub: string;
  email: string;
  phone?: string;
  nickname?: string;
  avatarUrl?: string;
  averageRating: number;
  completedTaskCount: number;
  birthday?: string | null;
  address?: string | null;
  bio?: string | null;
  createdAt: string;
  updatedAt: string;
}
