import { ChatSession, ChatMessage } from '../types/chat';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { calculateTotalPages } from '../utils/pagination';
import * as chatRepository from '../repositories/chatRepository';
import * as connectionManager from '../websocket/connectionManager';
import * as notificationService from './notificationService';
import { getPresignedUrl } from './uploadService';
import { query } from '../config/database';

/**
 * Chat Service - business logic for chat sessions and messages.
 *
 * Validates: Requirements 4.7, 4.8, 4.9, 4.10, 4.11
 */

/**
 * Enrich image messages with presigned URLs for secure access.
 */
async function enrichMessagesWithPresignedUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      if (msg.type === 'image' && msg.imageUrl) {
        const presignedUrl = await getPresignedUrl(msg.imageUrl);
        return { ...msg, imageUrl: presignedUrl };
      }
      return msg;
    })
  );
}

/**
 * List all chat sessions for a user.
 */
export async function listSessions(
  userId: string
): Promise<{ sessions: ChatSession[] }> {
  const sessions = await chatRepository.findSessionsByUserId(userId);
  return { sessions };
}

/**
 * List messages for a session with pagination.
 * Validates that the user is a participant of the session.
 * Also resets unread count for the user (marking as read).
 */
export async function listMessages(
  sessionId: string,
  userId: string,
  page: number,
  pageSize: number
): Promise<{ messages: ChatMessage[]; page: number; totalPages: number }> {
  // Verify user is a participant
  const session = await chatRepository.findSessionById(sessionId);
  if (!session) {
    throw new NotFoundError('会话不存在');
  }

  if (session.poster_id !== userId && session.helper_id !== userId) {
    throw new ForbiddenError('无权访问该会话');
  }

  // Reset unread count (user is reading messages)
  await chatRepository.resetUnreadCount(sessionId, userId);

  // Fetch messages and count
  const [messages, totalCount] = await Promise.all([
    chatRepository.findMessages(sessionId, page, pageSize),
    chatRepository.countMessages(sessionId),
  ]);

  const totalPages = calculateTotalPages(totalCount, pageSize);

  // Generate presigned URLs for image messages
  const enrichedMessages = await enrichMessagesWithPresignedUrls(messages);

  return {
    messages: enrichedMessages,
    page,
    totalPages,
  };
}

/**
 * Send a message via REST API (degraded path).
 * Validates, persists, and forwards (reusing WebSocket message forwarding logic).
 */
export async function sendMessage(
  sessionId: string,
  senderId: string,
  content: string,
  type: 'text' | 'image',
  imageUrl?: string
): Promise<ChatMessage> {
  // Validate message content
  if (type === 'text') {
    if (!content || content.length === 0) {
      throw new ValidationError({ content: '消息内容不能为空' });
    }
    if (content.length > 1000) {
      throw new ValidationError({ content: '消息内容不能超过1000字符' });
    }
  }

  if (type === 'image') {
    if (!imageUrl || imageUrl.length === 0) {
      throw new ValidationError({ imageUrl: '图片消息需包含有效的 imageUrl' });
    }
  }

  // Verify sender is a participant
  const session = await chatRepository.findSessionById(sessionId);
  if (!session) {
    throw new NotFoundError('会话不存在');
  }

  if (session.poster_id !== senderId && session.helper_id !== senderId) {
    throw new ForbiddenError('您不是该会话的参与者');
  }

  // Persist message
  const message = await chatRepository.createMessage(
    sessionId,
    senderId,
    content,
    type,
    imageUrl
  );

  // Update session last message
  const messagePreview = type === 'image' ? '[图片]' : content;
  await chatRepository.updateSessionLastMessage(sessionId, messagePreview, senderId);

  // Forward to recipient if online, otherwise send push notification
  const recipientId = session.poster_id === senderId
    ? session.helper_id
    : session.poster_id;

  const recipientWs = connectionManager.getConnection(recipientId);

  if (recipientWs) {
    // Generate presigned URL for image messages before forwarding
    const forwardImageUrl = message.type === 'image' && message.imageUrl
      ? await getPresignedUrl(message.imageUrl)
      : message.imageUrl;

    const forwardPayload = JSON.stringify({
      type: 'message',
      message: {
        id: message.id,
        sessionId: message.sessionId,
        senderId: message.senderId,
        content: message.content,
        type: message.type,
        imageUrl: forwardImageUrl,
        timestamp: message.timestamp,
        status: 'sent',
      },
    });
    recipientWs.send(forwardPayload);
  } else {
    // Offline — send push notification
    const senderResult = await query<{ nickname: string }>(
      'SELECT nickname FROM users WHERE id = $1',
      [senderId]
    );
    const senderNickname = senderResult.rows[0]?.nickname ?? '用户';
    await notificationService.notifyNewMessage(recipientId, senderNickname, messagePreview);
  }

  return message;
}

/**
 * Create a chat session if it doesn't already exist (idempotent).
 * Returns the session ID.
 */
export async function createSessionIfNotExists(
  taskId: string,
  posterId: string,
  helperId: string
): Promise<string> {
  return chatRepository.createSession(taskId, posterId, helperId);
}

/**
 * Mark a session as read for a user (reset unread count).
 */
export async function markAsRead(
  sessionId: string,
  userId: string
): Promise<void> {
  const session = await chatRepository.findSessionById(sessionId);
  if (!session) {
    throw new NotFoundError('会话不存在');
  }

  if (session.poster_id !== userId && session.helper_id !== userId) {
    throw new ForbiddenError('无权访问该会话');
  }

  await chatRepository.resetUnreadCount(sessionId, userId);
}
