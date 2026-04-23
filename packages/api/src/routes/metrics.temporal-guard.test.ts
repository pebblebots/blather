import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('temporal guard', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createFixture() {
    const requester = await harness.factories.createUser({ 
      email: 'requester@example.com', 
      displayName: 'Requester' 
    });
    return { requester };
  }

  it('allows newer data to overwrite older data', async () => {
    const { requester } = await createFixture();

    const testMetric = {
      companyName: 'Test Corp',
      fund: 'Fund A',
      reportingDate: '2024-01-01',
      revenueArrUsd: 1000000,
      revenueAsOfDate: '2024-01-15',
      source: 'agent' as const,
    };

    // Insert initial record
    const response1 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMetric),
    });
    
    expect(response1.status).toBe(201);
    const result1 = response1.body as any;
    expect(result1.wasInserted).toBe(true);

    // Try to update with newer data (should succeed)
    const newerMetric = {
      ...testMetric,
      revenueArrUsd: 1200000,
      revenueAsOfDate: '2024-02-15', // Newer date
    };

    const response2 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newerMetric),
    });

    expect(response2.status).toBe(200);
    const result2 = response2.body as any;
    expect(result2.wasInserted).toBe(false);
    expect(parseFloat(result2.revenueArrUsd)).toBe(1200000);
  });

  it('rejects stale data from overwriting newer data', async () => {
    const { requester } = await createFixture();

    const testMetric = {
      companyName: 'Test Corp 2',
      fund: 'Fund B',
      reportingDate: '2024-01-01',
      revenueArrUsd: 1000000,
      revenueAsOfDate: '2024-02-15', // Newer date
      source: 'agent' as const,
    };

    // Insert initial record with newer as_of date
    const response1 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMetric),
    });
    
    expect(response1.status).toBe(201);

    // Try to update with stale data (should be rejected)
    const staleMetric = {
      ...testMetric,
      revenueArrUsd: 1500000,
      revenueAsOfDate: '2024-01-15', // Older date
    };

    const response2 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(staleMetric),
    });

    expect(response2.status).toBe(409);
    const result2 = response2.body as any;
    expect(result2.error).toBe('Incoming data is stale');
    expect(result2.skipped).toBe(true);
    expect(result2.incomingAsOfDate).toBe('2024-01-15');
    expect(result2.existingAsOfDate).toBe('2024-02-15');

    // Verify original data is unchanged
    const response3 = await harness.request.get('/metrics?company_name=Test%20Corp%202', {
      headers: harness.headers.forUser(requester.id),
    });
    
    expect(response3.status).toBe(200);
    const metrics = response3.body as any;
    expect(metrics.length).toBe(1);
    expect(parseFloat(metrics[0].revenueArrUsd)).toBe(1000000); // Original value preserved
  });

  it('allows update when no existing as_of date', async () => {
    const { requester } = await createFixture();

    const testMetric = {
      companyName: 'Test Corp 3',
      fund: 'Fund C',
      reportingDate: '2024-01-01',
      revenueArrUsd: 1000000,
      // No revenueAsOfDate initially
      source: 'form' as const,
    };

    // Insert initial record without as_of date
    const response1 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMetric),
    });
    
    expect(response1.status).toBe(201);

    // Update with data that has as_of date (should succeed)
    const updateMetric = {
      ...testMetric,
      revenueArrUsd: 1200000,
      revenueAsOfDate: '2024-02-15',
    };

    const response2 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateMetric),
    });

    expect(response2.status).toBe(200);
    const result2 = response2.body as any;
    expect(parseFloat(result2.revenueArrUsd)).toBe(1200000);
  });

  it('allows update when incoming data has no as_of date', async () => {
    const { requester } = await createFixture();

    const testMetric = {
      companyName: 'Test Corp 4',
      fund: 'Fund D',
      reportingDate: '2024-01-01',
      revenueArrUsd: 1000000,
      revenueAsOfDate: '2024-01-15',
      source: 'agent' as const,
    };

    // Insert initial record with as_of date
    const response1 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMetric),
    });
    
    expect(response1.status).toBe(201);

    // Update without as_of date (should succeed - manual update)
    const updateMetric = {
      companyName: 'Test Corp 4',
      fund: 'Fund D',
      reportingDate: '2024-01-01',
      revenueArrUsd: 1200000,
      // No revenueAsOfDate - likely manual update
      source: 'form' as const,
    };

    const response2 = await harness.request.post('/metrics/upsert', {
      headers: {
        ...harness.headers.forUser(requester.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateMetric),
    });

    expect(response2.status).toBe(200);
    const result2 = response2.body as any;
    expect(parseFloat(result2.revenueArrUsd)).toBe(1200000);
  });
});