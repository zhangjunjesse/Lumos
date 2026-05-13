import { writeExcel } from '../excel-writer';

describe('writeExcel', () => {
  test('rejects sheets passed as a JSON string with an actionable error', async () => {
    await expect(
      writeExcel({
        filePath: '/tmp/should-not-write.xlsx',
        sheets: '[{"name":"Sheet1","rows":[["A"]] }]' as never,
      }),
    ).rejects.toThrow('write_spreadsheet.sheets must be an array');
  });
});
