import { createCodePlugin } from "@streamdown/code";
import type {
  CodeHighlighterPlugin,
  HighlightOptions,
  HighlightResult,
} from "@streamdown/code";
import { bundledLanguages } from "shiki";
import type { BundledLanguage } from "shiki";

const SUPPORTED_LANGUAGES = new Set(
  Object.keys(bundledLanguages) as BundledLanguage[]
);
const PLAIN_TEXT_LANGUAGE = "text" as BundledLanguage;

const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  "batch-plan": "json",
  "image-gen-request": "json",
  "image-gen-result": "json",
  "lumos-extension-plan": "json",
  "lumos-team-plan": "json",
  plaintext: PLAIN_TEXT_LANGUAGE,
};

function stripLanguagePrefix(language: string): string {
  return language.startsWith("language-")
    ? language.slice("language-".length)
    : language;
}

export function normalizeStreamdownCodeLanguage(
  language: string | null | undefined
): BundledLanguage {
  const normalized = stripLanguagePrefix((language || "").trim().toLowerCase());
  if (!normalized) {
    return PLAIN_TEXT_LANGUAGE;
  }

  const resolved = LANGUAGE_ALIASES[normalized] || normalized;
  if (SUPPORTED_LANGUAGES.has(resolved as BundledLanguage)) {
    return resolved as BundledLanguage;
  }

  return PLAIN_TEXT_LANGUAGE;
}

const baseCodePlugin = createCodePlugin();

export const streamdownCode: CodeHighlighterPlugin = {
  ...baseCodePlugin,
  highlight(
    options: HighlightOptions,
    callback?: (result: HighlightResult) => void
  ) {
    return baseCodePlugin.highlight(
      {
        ...options,
        language: normalizeStreamdownCodeLanguage(options.language),
      },
      callback
    );
  },
  supportsLanguage(language: BundledLanguage) {
    return baseCodePlugin.supportsLanguage(
      normalizeStreamdownCodeLanguage(language)
    );
  },
};
