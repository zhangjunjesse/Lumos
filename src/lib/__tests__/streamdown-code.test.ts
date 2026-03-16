const mockHighlight = jest.fn();
const mockSupportsLanguage = jest.fn((language: string) =>
  ["json", "typescript", "text"].includes(language)
);

jest.mock("@streamdown/code", () => ({
  createCodePlugin: () => ({
    name: "shiki",
    type: "code-highlighter",
    highlight: mockHighlight,
    supportsLanguage: mockSupportsLanguage,
    getSupportedLanguages: () => ["json", "typescript", "text"],
    getThemes: () => ["github-light", "github-dark"],
  }),
}));

jest.mock("shiki", () => ({
  bundledLanguages: {
    json: {},
    typescript: {},
  },
}));

import {
  normalizeStreamdownCodeLanguage,
  streamdownCode,
} from "../streamdown-code";

describe("streamdown code language normalization", () => {
  test("maps internal lumos block languages to bundled shiki languages", () => {
    expect(normalizeStreamdownCodeLanguage("lumos-team-plan")).toBe("json");
    expect(normalizeStreamdownCodeLanguage("batch-plan")).toBe("json");
    expect(normalizeStreamdownCodeLanguage("image-gen-request")).toBe("json");
  });

  test("falls back unknown languages to text", () => {
    expect(normalizeStreamdownCodeLanguage("totally-unknown-language")).toBe("text");
  });

  test("supports aliased internal languages through the wrapped plugin", () => {
    expect(streamdownCode.supportsLanguage("lumos-team-plan" as never)).toBe(true);
    expect(streamdownCode.supportsLanguage("totally-unknown-language" as never)).toBe(true);
    expect(mockSupportsLanguage).toHaveBeenCalledWith("json");
    expect(mockSupportsLanguage).toHaveBeenCalledWith("text");
  });
});
