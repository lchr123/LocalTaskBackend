import { query } from '../config/database';
import { ChatSession, ChatMessage } from '../types/chat';

/**
 * Database row shape for chat session queries.
 */
interface SessionRow {
  id: string;
  task_id: string;
  poster_id: string;
  helper_id: string;
  task_title: string;
  task_type: string | null;
  participant_id: string;
  participant_nickname: string;
  participant_avatar_url: string | null;
  last_message: string;
  last_message_time: string;
  unread_count: number;
}

/**
 * Raw session row without computed fields (for findSessionById).
 */
interface SessionBasicRow {
  id: string;
  task_id: string;
  poster_id: string;
  helper_id: string;
  last_message: string;
  last_message_time: string;
  poster_unread: number;
  helper_unread: number;
  created_at: string;
}

/**
 * Database row shape for chat message queries.
 */
interface MessageRow {
  id: string;
  session_id: string;
  sender_id: string;
  content: string;
  type: string;
  image_url: string | null;
  timestamp: string;
}

function mapRowToSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskType: row.task_type ?? undefined,
    participantId: row.participant_id,
    participantNickname: row.participant_nickname,
    participantAvatarUrl: row.participant_avatar_url ?? undefined,
    lastMessage: row.last_message,
    lastMessageTime: row.last_message_time,
    unreadCount: row.unread_count,
  };
}

function mapRowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    content: row.content,
    type: row.type as ChatMessage['type'],
    imageUrl: row.image_url ?? undefined,
    timestamp: row.timestamp,
    status: 'sent',
  };
}

/**
 * Find all chat sessions for a user (as poster or helper).
 * JOINs users to get the other participant's info, JOINs tasks for taskTitle.
 * Computes unreadCount based on whether user is poster or helper.
 * Ordered by last_message_time DESC.
 *
 * Validates: Requirements 4.7, 4.10
 */
export async function findSessionsByUserId(userId: string): Promise<ChatSession[]> {
  const sql = `
    SELECT
      cs.id,
      cs.task_id,
      cs.poster_id,
      cs.helper_id,
      COALESCE(LEFT(t.description, 50), '') AS task_title,
      t.type AS task_type,
      CASE
        WHEN cs.poster_id = $1 THEN cs.helper_id
        ELSE cs.poster_id
      END AS participant_id,
      CASE
        WHEN cs.poster_id = $1 THEN helper_u.nickname
        ELSE poster_u.nickname
      END AS participant_nickname,
      CASE
        WHEN cs.poster_id = $1 THEN helper_u.avatar_url
        ELSE poster_u.avatar_url
      END AS participant_avatar_url,
      cs.last_message,
      cs.last_message_time,
      CASE
        WHEN cs.poster_id = $1 THEN cs.poster_unread
        ELSE cs.helper_unread
      END AS unread_count
    FROM chat_sessions cs
    JOIN users poster_u ON cs.poster_id = poster_u.id
    JOIN users helper_u ON cs.helper_id = helper_u.id
    LEFT JOIN tasks t ON cs.task_id = t.id
    WHERE cs.poster_id = $1 OR cs.helper_id = $1
    ORDER BY cs.last_message_time DESC
  `;

  const result = await query<SessionRow>(sql, [userId]);
  return result.rows.map(mapRowToSession);
}

/**
 * Find a single chat session by ID.
 * Returns the raw session data including poster_id and helper_id.
 *
 * Validates: Requirements 4.8
 */
export async function findSessionById(sessionId: string): Promise<SessionBasicRow | null> {
  const sql = `
    SELECT id, task_id, poster_id, helper_id,
           last_message, last_message_time,
           poster_unread, helper_unread, created_at
    FROM chat_sessions
    WHERE id = $1
  `;

  const result = await query<SessionBasicRow>(sql, [sessionId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a new chat session (idempotent via unique constraint).
 * Uses ON CONFLICT to handle duplicate (task_id, poster_id, helper_id).
 * Returns the session ID.
 *
 * Validates: Requirements 4.11, 9.8
 */
export async function createSession(
  taskId: string,
  posterId: string,
  helperId: string
): Promise<string> {
  const sql = `
    INSERT INTO chat_sessions (task_id, poster_id, helper_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (task_id, poster_id, helper_id) DO UPDATE
      SET task_id = EXCLUDED.task_id
    RETURNING id
  `;

  const result = await query<{ id: string }>(sql, [taskId, posterId, helperId]);
  return result.rows[0].id;
}

/**
 * Find messages for a session with pagination.
 * Ordered by timestamp DESC (newest first).
 *
 * Validates: Requirements 4.8
 */
export async function findMessages(
  sessionId: string,
  page: number,
  pageSize: number
): Promise<ChatMessage[]> {
  const offset = (page - 1) * pageSize;

  const sql = `
    SELECT id, session_id, sender_id, content, type, image_url, timestamp
    FROM chat_messages
    WHERE session_id = $1
    ORDER BY timestamp DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await query<MessageRow>(sql, [sessionId, pageSize, offset]);
  return result.rows.map(mapRowToMessage);
}

/**
 * Count total messages in a session (for pagination).
 *
 * Validates: Requirements 4.8
 */
export async function countMessages(sessionId: string): Promise<number> {
  const sql = `
    SELECT COUNT(*) AS count
    FROM chat_messages
    WHERE session_id = $1
  `;

  const result = await query<{ count: string }>(sql, [sessionId]);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Create a new chat message.
 * Returns the created message.
 *
 * Validates: Requirements 4.3
 */
export async function createMessage(
  sessionId: string,
  senderId: string,
  content: string,
  type: 'text' | 'image',
  imageUrl?: string
): Promise<ChatMessage> {
  const sql = `
    INSERT INTO chat_messages (session_id, sender_id, content, type, image_url)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, session_id, sender_id, content, type, image_url, timestamp
  `;

  const result = await query<MessageRow>(sql, [
    sessionId,
    senderId,
    content,
    type,
    imageUrl ?? null,
  ]);

  return mapRowToMessage(result.rows[0]);
}

/**
 * Update session's last message info and increment the other party's unread count.
 * Determines which unread counter to increment based on senderId.
 *
 * Validates: Requirements 4.3, 4.10
 */
export async function updateSessionLastMessage(
  sessionId: string,
  content: string,
  senderId: string
): Promise<void> {
  // First get the session to determine roles
  const session = await findSessionById(sessionId);
  if (!session) return;

  // Increment the OTHER party's unread count
  const unreadColumn = session.poster_id === senderId
    ? 'helper_unread'
    : 'poster_unread';

  const sql = `
    UPDATE chat_sessions
    SET last_message = $2,
        last_message_time = NOW(),
        ${unreadColumn} = ${unreadColumn} + 1
    WHERE id = $1
  `;

  await query(sql, [sessionId, content]);
}

/**
 * Reset unread count for a user in a session.
 * Determines which counter to reset based on userId's role in the session.
 *
 * Validates: Requirements 4.10
 */
export async function resetUnreadCount(
  sessionId: string,
  userId: string
): Promise<void> {
  // Determine if user is poster or helper
  const session = await findSessionById(sessionId);
  if (!session) return;

  const unreadColumn = session.poster_id === userId
    ? 'poster_unread'
    : 'helper_unread';

  const sql = `
    UPDATE chat_sessions
    SET ${unreadColumn} = 0
    WHERE id = $1
  `;

  await query(sql, [sessionId]);
}
