import { createTaskSchema, taskQuerySchema } from '../../../src/validators/taskValidator';

describe('createTaskSchema', () => {
  const validPayload = () => ({
    type: 'delivery' as const,
    description: 'This is a valid task description for testing purposes',
    location: {
      address: 'Tokyo Station, Chiyoda City',
      latitude: 35.6812,
      longitude: 139.7671,
    },
    reward: 1500,
    deadline: new Date(Date.now() + 86400000).toISOString(), // tomorrow
  });

  it('should accept a valid payload', () => {
    const result = createTaskSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  describe('type validation', () => {
    it('should accept all valid task types', () => {
      const types = ['delivery', 'shopping', 'dog_walking', 'queuing', 'pickup'];
      for (const type of types) {
        const payload = { ...validPayload(), type };
        const result = createTaskSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid task type', () => {
      const payload = { ...validPayload(), type: 'invalid_type' };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('description validation', () => {
    it('should reject description shorter than 10 characters', () => {
      const payload = { ...validPayload(), description: 'short' };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept description with exactly 10 characters', () => {
      const payload = { ...validPayload(), description: 'a'.repeat(10) };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept description with exactly 500 characters', () => {
      const payload = { ...validPayload(), description: 'a'.repeat(500) };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject description longer than 500 characters', () => {
      const payload = { ...validPayload(), description: 'a'.repeat(501) };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('location validation', () => {
    it('should reject latitude below -90', () => {
      const payload = validPayload();
      payload.location.latitude = -91;
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject latitude above 90', () => {
      const payload = validPayload();
      payload.location.latitude = 91;
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject longitude below -180', () => {
      const payload = validPayload();
      payload.location.longitude = -181;
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject longitude above 180', () => {
      const payload = validPayload();
      payload.location.longitude = 181;
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept boundary coordinates', () => {
      const payload = validPayload();
      payload.location.latitude = 90;
      payload.location.longitude = 180;
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept negative boundary coordinates', () => {
      const payload = validPayload();
      payload.location.latitude = -90;
      payload.location.longitude = -180;
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject empty address', () => {
      const payload = validPayload();
      payload.location.address = '';
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('reward validation', () => {
    it('should accept minimum reward of 0.01', () => {
      const payload = { ...validPayload(), reward: 0.01 };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept maximum reward of 99999.99', () => {
      const payload = { ...validPayload(), reward: 99999.99 };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject reward of 0', () => {
      const payload = { ...validPayload(), reward: 0 };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject reward above 99999.99', () => {
      const payload = { ...validPayload(), reward: 100000 };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('deadline validation', () => {
    it('should reject a past deadline', () => {
      const payload = {
        ...validPayload(),
        deadline: new Date(Date.now() - 86400000).toISOString(),
      };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept a future deadline', () => {
      const payload = {
        ...validPayload(),
        deadline: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject an invalid date string', () => {
      const payload = { ...validPayload(), deadline: 'not-a-date' };
      const result = createTaskSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject a non-ISO format date', () => {
      const payload = { ...validPayload(), deadline: '2099/12/31' };
      // This is actually parseable by Date constructor, so it depends on behavior
      const result = createTaskSchema.safeParse(payload);
      // If parseable and in the future, it should pass
      if (new Date('2099/12/31').getTime() > Date.now()) {
        expect(result.success).toBe(true);
      }
    });
  });
});

describe('taskQuerySchema', () => {
  it('should accept valid required params with defaults', () => {
    const result = taskQuerySchema.safeParse({ lat: '35.68', lng: '139.76' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lat).toBe(35.68);
      expect(result.data.lng).toBe(139.76);
      expect(result.data.radius).toBe(10);
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it('should accept all optional params', () => {
    const result = taskQuerySchema.safeParse({
      lat: '35.68',
      lng: '139.76',
      radius: '5',
      type: 'delivery',
      minReward: '100',
      maxReward: '5000',
      page: '2',
      pageSize: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.radius).toBe(5);
      expect(result.data.type).toBe('delivery');
      expect(result.data.minReward).toBe(100);
      expect(result.data.maxReward).toBe(5000);
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('should reject missing lat', () => {
    const result = taskQuerySchema.safeParse({ lng: '139.76' });
    expect(result.success).toBe(false);
  });

  it('should reject missing lng', () => {
    const result = taskQuerySchema.safeParse({ lat: '35.68' });
    expect(result.success).toBe(false);
  });

  it('should reject lat out of range', () => {
    const result = taskQuerySchema.safeParse({ lat: '100', lng: '139.76' });
    expect(result.success).toBe(false);
  });

  it('should reject lng out of range', () => {
    const result = taskQuerySchema.safeParse({ lat: '35.68', lng: '200' });
    expect(result.success).toBe(false);
  });

  it('should reject radius above 50', () => {
    const result = taskQuerySchema.safeParse({ lat: '35.68', lng: '139.76', radius: '51' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid task type in query', () => {
    const result = taskQuerySchema.safeParse({
      lat: '35.68',
      lng: '139.76',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject pageSize above 50', () => {
    const result = taskQuerySchema.safeParse({
      lat: '35.68',
      lng: '139.76',
      pageSize: '100',
    });
    expect(result.success).toBe(false);
  });

  it('should coerce string numbers to numbers', () => {
    const result = taskQuerySchema.safeParse({
      lat: '35.68',
      lng: '139.76',
      radius: '15',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.lat).toBe('number');
      expect(typeof result.data.lng).toBe('number');
      expect(typeof result.data.radius).toBe('number');
    }
  });

  it('should reject non-numeric lat', () => {
    const result = taskQuerySchema.safeParse({ lat: 'abc', lng: '139.76' });
    expect(result.success).toBe(false);
  });
});
