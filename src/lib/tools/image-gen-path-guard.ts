// 图片生成输入校验(纯函数、无 SDK 依赖,便于单测)。
// image-gen-tool.ts 依赖 @anthropic-ai/claude-agent-sdk(ESM),无法在 jest 直接加载,
// 故把"检测 prompt 内嵌入的绝对图片路径"逻辑抽到这里。

const PROMPT_EMBEDDED_IMAGE_PATH_RE =
  /(?:^|[\s([{"'`,])((?:\/|[a-zA-Z]:[\\/])[^\s()[\]{}"'`,<>]+\.(?:jpg|jpeg|png|webp|gif|bmp|heic|heif|avif))(?=$|[\s)\]}"'`,.;:!?])/gi;

/**
 * Detect absolute local image file paths embedded in the prompt text.
 * Catches the common agent mistake of copying reference-image paths into the
 * natural-language `prompt` field instead of populating `reference_image_paths`.
 */
export function findEmbeddedImagePaths(prompt: string): string[] {
  if (!prompt) return [];
  const found = new Set<string>();
  for (const m of prompt.matchAll(PROMPT_EMBEDDED_IMAGE_PATH_RE)) {
    found.add(m[1]);
  }
  return [...found];
}

/** 跨平台路径比较:统一斜杠方向 + 大小写(Windows C:\ 与 c:/ 视为同一路径)。 */
function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Absolute image paths embedded in the prompt that are NOT in reference_image_paths.
 * Those are the real mistake — the provider receives no reference image for them.
 *
 * Paths embedded in the prompt that ARE also in reference_image_paths are harmless
 * duplicates: the reference is correctly supplied, so generation must NOT be blocked.
 * This happens routinely because the context-image injector prepends
 * "[Context Image N: /abs/path]" to the agent's text and the agent echoes the path
 * into `prompt` while still (correctly) populating `reference_image_paths` (#28 —
 * the old all-or-nothing check made image-to-image fail 100% of the time).
 */
export function findUnreferencedPromptPaths(prompt: string, referencePaths: string[] = []): string[] {
  const embedded = findEmbeddedImagePaths(prompt);
  if (embedded.length === 0) return [];
  const refSet = new Set(referencePaths.map(normalizePathForCompare));
  return embedded.filter((p) => !refSet.has(normalizePathForCompare(p)));
}
