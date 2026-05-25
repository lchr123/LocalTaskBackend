export interface ChatSession {
  id: string;
  taskId: string;
  taskTitle: string;
  participantId: string;
  participantNickname: string;
  participantAvatarUrl?: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image';
  imageUrl?: string;
  timestamp: string;
  status: 'sending' | 'sent' | 'delivered' | 'failed';
}
