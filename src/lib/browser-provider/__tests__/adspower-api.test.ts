import { fetchAdsPowerProfiles, normalizeAdsPowerApiBaseUrl } from '../adspower-api';

describe('AdsPower API helpers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('normalizes legacy local API host to localhost', () => {
    expect(normalizeAdsPowerApiBaseUrl('http://local.adspower.net:50325/'))
      .toBe('http://127.0.0.1:50325');
  });

  test('fetches AdsPower profiles across pages', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          total: 3,
          list: [
            { user_id: 'p1', name: '浏览器1', group_name: 'A组', serial_number: 1 },
            { user_id: 'p2', name: '浏览器2', group_name: 'A组', serial_number: 2 },
          ],
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          total: 3,
          list: [
            { user_id: 'p3', name: '浏览器3', group_name: 'B组', serial_number: 3 },
          ],
        },
      })));
    global.fetch = fetchMock;

    const profiles = await fetchAdsPowerProfiles({
      apiBaseUrl: 'http://127.0.0.1:50325',
      pageSize: 2,
      maxProfiles: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(profiles.map((profile) => profile.id)).toEqual(['p1', 'p2', 'p3']);
    expect(profiles[0]).toMatchObject({
      name: '浏览器1',
      group: 'A组',
      serial_number: '1',
    });
  });
});
