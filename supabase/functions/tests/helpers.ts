// Shared test helpers for Edge Function tests
// Mocks Supabase client and Resend API

export interface MockQueryResult {
  data: unknown;
  error: null | { message: string };
}

export interface MockRow {
  [key: string]: unknown;
}

// Creates a mock Supabase client that returns configured data
export function createMockSupabase(tables: Record<string, MockRow[]>) {
  function buildQuery(tableName: string) {
    let rows = [...(tables[tableName] || [])];
    const filters: Array<(rows: MockRow[]) => MockRow[]> = [];
    let isSingle = false;

    const chain: Record<string, unknown> = {
      select: (_cols?: string) => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r.filter((row) => row[col] === val));
        return chain;
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r.filter((row) => row[col] !== val));
        return chain;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => r.filter((row) => vals.includes(row[col])));
        return chain;
      },
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) {
          filters.push((r) => r.filter((row) => row[col] != null));
        }
        return chain;
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => r.filter((row) => (row[col] as string) >= (val as string)));
        return chain;
      },
      lte: (col: string, val: unknown) => {
        filters.push((r) => r.filter((row) => (row[col] as string) <= (val as string)));
        return chain;
      },
      order: (_col: string) => chain,
      single: () => {
        isSingle = true;
        return chain;
      },
      maybeSingle: () => {
        isSingle = true;
        return chain;
      },
      then: (resolve: (val: MockQueryResult) => void) => {
        let result = rows;
        for (const f of filters) result = f(result);
        if (isSingle) {
          resolve({ data: result[0] || null, error: null });
        } else {
          resolve({ data: result, error: null });
        }
      },
    };
    return chain;
  }

  function buildMutation(tableName: string) {
    const chain: Record<string, unknown> = {
      eq: () => chain,
      select: () => chain,
      single: () => chain,
      then: (resolve: (val: MockQueryResult) => void) => {
        resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => ({
      select: (cols?: string) => buildQuery(table).select(cols),
      insert: (_data: unknown) => buildMutation(table),
      update: (_data: unknown) => buildMutation(table),
      upsert: (_data: unknown, _opts?: unknown) => buildMutation(table),
      delete: () => buildMutation(table),
    }),
  };
}

// Mock fetch that captures Resend API calls
export function createMockFetch(responses?: Record<string, { ok: boolean; body: unknown }>) {
  const calls: Array<{ url: string; options: RequestInit }> = [];

  const mockFetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    calls.push({ url: urlStr, options: options || {} });

    const configured = responses?.[urlStr];
    return {
      ok: configured?.ok ?? true,
      json: async () => configured?.body ?? { id: "mock-email-id" },
    } as Response;
  };

  return { fetch: mockFetch, calls };
}

// Build a Request object for testing
export function buildRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
  url?: string,
): Request {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return new Request(url || "http://localhost/test", init);
}
