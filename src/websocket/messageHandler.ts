import WebSocket from 'ws';
import { logger } from '../utils/logger';
import * as chatRepository from '../repositories/chatRepository';
import * as connectionManager from './connectionManager';
import * as notificationService from '../services/notificationService';
import { query } from '../config/database';

/**
 * Client message format sent via WebSocket.
 */
interface ClientMessage {
  type: 'text' | 'image';
  sessionId: string;
  content: string;
  localId: string;
  imageUrl?: string;
}

/**
 * Ack message sent back to the sender on success.
 */
interface AckMessage {
  type: 'ack';
  localId: string;
  messageId: string;
}

/**
 * Error message sent back to the sender on failure.
 */
interface ErrorMessage {
  type: 'error';
  localId: string;
  error: string;
}

/**
 * Message forwarded to the recipient.
 */
interface ForwardMessage {
  type: 'message';
  message: {
    id: string;
    sessionId: string;
    senderId: string;
    content: string;
    type: 'text' | 'image';
    imageUrl?: string;
    timestamp: string;
    status: 'sent';
  };
}

/**
 * Send a JSON message through a WebSocket connection.
 */
function sendJson(ws: WebSocket, data: AckMessage | ErrorMessage | ForwardMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Validate the client message structure and content.
 */
function validateMessage(msg: ClientMessage): string | null {
  if (!msg.sessionId || typeof msg.sessionId !== 'string') {
    return 'sessionId 不能为空';
  }

  if (!msg.localId || typeof msg.localId !== 'string') {
    return 'localId 不能为空';
  }

  if (!msg.type || (msg.type !== 'text' && msg.type !== 'image')) {
    return '消息类型无效';
  }

  if (msg.type === 'text') {
    if (!msg.content || typeof msg.content !== 'string') {
      return '消息内容不能为空';
    }
    if (msg.content.length > 1000) {
      return '消息内容不能超过1000字符';
    }
  }

  if (msg.type === 'image') {
    if (!msg.imageUrl || typeof msg.imageUrl !== 'string') {
      return '图片消息需包含有效的 imageUrl';
    }
  }

  return null;
}

/**
 * Get the sender's nickname for push notifications.
 */
async function getSenderNickname(senderId: string): Promise<string> {
  const result = await query<{ nickname: string }>(
    'SELECT nickname FROM users WHERE id = $1',
    [senderId]
  );
  return result.rows[0]?.nickname ?? '用户';
}

/**
 * Handle an incoming WebSocket message from a client.
 * Validates, persists, sends ack, and forwards to recipient.
 *
 * Validates: Requirements 4.3, 4.4, 4.5
 */
export async function handleMessage(
  ws: WebSocket,
  senderId: string,
  rawMessage: string
): Promise<void> {
  let msg: ClientMessage;

  // 1. Parse JSON
  try {
    msg = JSON.parse(rawMessage);
  } catch {
    sendJson(ws, {
      type: 'error',
      localId: '',
      error: '消息格式无效',
    });
    return;
  }

  const localId = msg.localId || '';

  // 2. Validate message content
  const validationError = validateMessage(msg);
  if (validationError) {
    sendJson(ws, { type: 'error', localId, error: validationError });
    return;
  }

  // 3. Verify sender is a participant of the session
  const session = await chatRepository.findSessionById(msg.sessionId);
  if (!session) {
    sendJson(ws, { type: 'error', localId, error: '会话不存在' });
    return;
  }

  if (session.poster_id !== senderId && session.helper_id !== senderId) {
    sendJson(ws, { type: 'error', localId, error: '您不是该会话的参与者' });
    return;
  }

  // 4. Persist message to database
  let savedMessage;
  try {
    savedMessage = await chatRepository.createMessage(
      msg.sessionId,
      senderId,
      msg.content || '',
      msg.type,
      msg.imageUrl
    );
  } catch (err) {
    logger.error('Failed to persist chat message', {
      senderId,
      sessionId: msg.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(ws, { type: 'error', localId, error: '消息发送失败' });
    return;
  }

  // 5. Update session last message and unread count
  const messagePreview = msg.type === 'image' ? '[图片]' : msg.content;
  try {
    await chatRepository.updateSessionLastMessage(msg.sessionId, messagePreview, senderId);
  } catch (err) {
    logger.error('Failed to update session last message', {
      sessionId: msg.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Send ack to sender
  sendJson(ws, {
    type: 'ack',
    localId,
    messageId: savedMessage.id,
  });

  // 7. Forward message to recipient (or send push notification if offline)
  const recipientId = session.poster_id === senderId
    ? session.helper_id
    : session.poster_id;

  const recipientWs = connectionManager.getConnection(recipientId);

  if (recipientWs) {
    // Recipient is online — forward the message
    sendJson(recipientWs, {
      type: 'message',
      message: {
        id: savedMessage.id,
        sessionId: savedMessage.sessionId,
        senderId: savedMessage.senderId,
        content: savedMessage.content,
        type: savedMessage.type,
        imageUrl: savedMessage.imageUrl,
        timestamp: savedMessage.timestamp,
        status: 'sent',
      },
    });
  } else {
    // Recipient is offline — send push notification
    try {
      const senderNickname = await getSenderNickname(senderId);
      await notificationService.notifyNewMessage(
        recipientId,
        senderNickname,
        messagePreview
      );
    } catch (err) {
      logger.error('Failed to send push notification', {
        recipientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
