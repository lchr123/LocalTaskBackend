export type TaskType = string;
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

/** Billing unit for the reward amount. */
export type RewardUnit = 'once' | 'hour' | 'day' | 'month';
/** Per-unit for the estimated duration (e.g. "2.5 小时/次"). */
export type DurationUnit = 'once' | 'day' | 'week' | 'month';

/** A task tag from the task_tags dictionary. */
export interface TaskTag {
  id: string;
  name: string;
  label_zh: string;
  category: string | null;
}

export interface Task {
  id: string;
  posterId: string;
  posterNickname: string;
  posterRating: number;
  type: TaskType;
  description: string;
  location: {
    address: string;
    latitude: number;
    longitude: number;
  };
  reward: number;
  /** Optional billing unit; null means unspecified. */
  rewardUnit?: RewardUnit | null;
  deadline: string;
  status: TaskStatus;
  intentCount: number;
  selectedHelperId?: string;
  createdAt: string;
  distance?: number;
  /** Task photo URLs (full S3 URLs, presigned on read). */
  images: string[];
  /** Number of helpers to recruit (>= 1). */
  headcount: number;
  /** Planned start time (ISO string) or null. */
  startTime?: string | null;
  /** Preferred contact method (free text) or null. */
  contactMethod?: string | null;
  /** Estimated duration in hours or null. */
  durationHours?: number | null;
  /** Per-unit for durationHours or null. */
  durationUnit?: DurationUnit | null;
  /**
   * Poster-only private memo. Only populated when the requester is the poster
   * (e.g. GET /tasks/mine). Never exposed on public endpoints.
   */
  posterMemo?: string | null;
  /** Task tags (many-to-many). */
  tags?: TaskTag[];
}

export interface CreateTaskPayload {
  type: TaskType;
  description: string;
  location: {
    address: string;
    latitude: number;
    longitude: number;
  };
  reward: number;
  deadline: string;
  rewardUnit?: RewardUnit | null;
  images?: string[];
  headcount?: number;
  startTime?: string | null;
  contactMethod?: string | null;
  durationHours?: number | null;
  durationUnit?: DurationUnit | null;
  posterMemo?: string | null;
  /** Tag ids to associate with the task. */
  tagIds?: string[];
}

export interface UpdateTaskPayload {
  description?: string;
  reward?: number;
  location?: { address: string; latitude: number; longitude: number };
  deadline?: string;
  rewardUnit?: RewardUnit | null;
  images?: string[];
  headcount?: number;
  startTime?: string | null;
  contactMethod?: string | null;
  durationHours?: number | null;
  durationUnit?: DurationUnit | null;
  /** Tag ids to associate with the task (replaces existing set). */
  tagIds?: string[];
}
