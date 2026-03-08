import crypto from "crypto";
import path from "path";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function buildSourceKey(options: {
  sourceType: string;
  sourcePath?: string;
  content?: string;
  extraId?: string;
}): string {
  const sourceType = options.sourceType;
  const sourcePath = options.sourcePath?.trim();
  const extraId = options.extraId?.trim();

  switch (sourceType) {
    case "local_file":
      return sourcePath ? `file:${path.resolve(sourcePath)}` : "";
    case "local_dir":
      return sourcePath ? `dir:${path.resolve(sourcePath)}` : "";
    case "feishu":
      if (extraId) return `feishu:${extraId}`;
      return sourcePath ? `feishu:${path.resolve(sourcePath)}` : "";
    case "webpage":
      return sourcePath ? `url:${normalizeUrl(sourcePath)}` : "";
    case "manual":
      if (!options.content) return "";
      return `manual:${hashContent(options.content.trim())}`;
    default:
      return sourcePath ? `${sourceType}:${sourcePath}` : "";
  }
}
