import type { AdapterContext } from '../adapter-types';
import { pmcBiocAdapter } from '../adapters/pmc-bioc';

function createContextWithMap(map: Record<string, { status?: number; html: string; contentType?: string }>): AdapterContext {
  return {
    fetch: jest.fn(async (url: string) => {
      const hit = map[url];
      if (!hit) {
        throw new Error(`unexpected url: ${url}`);
      }
      return {
        status: hit.status ?? 200,
        html: hit.html,
        contentType: hit.contentType ?? 'application/json',
      };
    }),
    browserCapture: jest.fn(),
    siteEvaluate: jest.fn(),
  };
}

describe('pmc bioc adapter', () => {
  test('searches open-access pmc papers through Europe PMC', async () => {
    const queryUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=gene+editing+OPEN_ACCESS%3Ay+IN_PMC%3Ay&format=json&pageSize=5&resultType=core';
    const ctx = createContextWithMap({
      [queryUrl]: {
        html: JSON.stringify({
          resultList: {
            result: [
              {
                title: 'Gene editing in practice',
                pmcid: 'PMC123456',
                pmid: '999999',
                doi: '10.1000/test',
                source: 'MED',
                abstractText: 'Open access abstract.',
              },
            ],
          },
        }),
      },
    });

    const result = await pmcBiocAdapter.search(ctx, 'gene editing', 5);
    expect(result.items).toEqual([
      {
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/',
        title: 'Gene editing in practice',
        snippet: 'Open access abstract.',
        extra: {
          pmcid: 'PMC123456',
          pmid: '999999',
          doi: '10.1000/test',
          source: 'MED',
        },
      },
    ]);
  });

  test('extracts full text via official BioC JSON', async () => {
    const biocUrl = 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/PMC123456/unicode';
    const ctx = createContextWithMap({
      [biocUrl]: {
        html: JSON.stringify([
          {
            source: 'PMC',
            documents: [
              {
                id: 'PMC123456',
                passages: [
                  { text: 'Gene editing in practice' },
                  { text: 'First paragraph of the paper body.' },
                  { text: 'Second paragraph of the paper body.' },
                ],
              },
            ],
          },
        ]),
      },
    });

    const result = await pmcBiocAdapter.extract(ctx, 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/');
    expect(result.title).toBe('Gene editing in practice');
    expect(result.contentText).toContain('First paragraph of the paper body.');
    expect(result.contentState).toBe('partial');
    expect(result.structuredData).toMatchObject({
      adapter: 'pmc_bioc',
      pageType: 'bioc_json',
      pmcid: 'PMC123456',
      documentId: 'PMC123456',
      passageCount: 3,
    });
  });
});
