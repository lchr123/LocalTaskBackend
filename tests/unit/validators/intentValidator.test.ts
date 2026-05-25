import {
  submitIntentSchema,
  selectHelperSchema,
  intentParamsSchema,
  intentIdParamsSchema,
} from '../../../src/validators/intentValidator';

describe('submitIntentSchema', () => {
  it('should accept an empty body (message is optional)', () => {
    const result = submitIntentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept a valid message', () => {
    const result = submitIntentSchema.safeParse({ message: 'I can help with this task!' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('I can help with this task!');
    }
  });

  it('should accept a message with exactly 200 characters', () => {
    const result = submitIntentSchema.safeParse({ message: 'a'.repeat(200) });
    expect(result.success).toBe(true);
  });

  it('should reject a message longer than 200 characters', () => {
    const result = submitIntentSchema.safeParse({ message: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('should accept undefined message', () => {
    const result = submitIntentSchema.safeParse({ message: undefined });
    expect(result.success).toBe(true);
  });

  it('should accept an empty string message', () => {
    const result = submitIntentSchema.safeParse({ message: '' });
    expect(result.success).toBe(true);
  });
});

describe('selectHelperSchema', () => {
  const validUUID = '550e8400-e29b-41d4-a716-446655440000';

  it('should accept a valid UUID helperId', () => {
    const result = selectHelperSchema.safeParse({ helperId: validUUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.helperId).toBe(validUUID);
    }
  });

  it('should accept uppercase UUID', () => {
    const result = selectHelperSchema.safeParse({
      helperId: '550E8400-E29B-41D4-A716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing helperId', () => {
    const result = selectHelperSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject invalid UUID format', () => {
    const result = selectHelperSchema.safeParse({ helperId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('should reject UUID without hyphens', () => {
    const result = selectHelperSchema.safeParse({
      helperId: '550e8400e29b41d4a716446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty string', () => {
    const result = selectHelperSchema.safeParse({ helperId: '' });
    expect(result.success).toBe(false);
  });
});

describe('intentParamsSchema', () => {
  const validUUID = '550e8400-e29b-41d4-a716-446655440000';

  it('should accept a valid UUID task id', () => {
    const result = intentParamsSchema.safeParse({ id: validUUID });
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID format', () => {
    const result = intentParamsSchema.safeParse({ id: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('intentIdParamsSchema', () => {
  const validUUID = '550e8400-e29b-41d4-a716-446655440000';
  const anotherUUID = '660e8400-e29b-41d4-a716-446655440000';

  it('should accept valid task id and intent id', () => {
    const result = intentIdParamsSchema.safeParse({ id: validUUID, intentId: anotherUUID });
    expect(result.success).toBe(true);
  });

  it('should reject invalid task id', () => {
    const result = intentIdParamsSchema.safeParse({ id: 'bad', intentId: anotherUUID });
    expect(result.success).toBe(false);
  });

  it('should reject invalid intent id', () => {
    const result = intentIdParamsSchema.safeParse({ id: validUUID, intentId: 'bad' });
    expect(result.success).toBe(false);
  });

  it('should reject when both are invalid', () => {
    const result = intentIdParamsSchema.safeParse({ id: 'bad', intentId: 'bad' });
    expect(result.success).toBe(false);
  });
});
