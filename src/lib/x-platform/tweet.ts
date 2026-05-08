import { gqlPost } from './graphql-client';
import { buildCreateTweet } from './graphql-queries';
import type { XTweet } from './types';

interface CreateTweetData {
  create_tweet?: {
    tweet_results?: {
      result?: {
        rest_id?: string;
        legacy?: { full_text?: string; created_at?: string };
      };
    };
  };
}

export interface PostTweetInput {
  text: string;
  /** 已上传到 X 的 media_id 列表 (从 uploadImage 拿到), 最多 4 张。 */
  mediaIds?: string[];
}

export async function postTweet(input: PostTweetInput | string): Promise<XTweet> {
  const opts: PostTweetInput = typeof input === 'string' ? { text: input } : input;
  const trimmed = opts.text.trim();
  if (!trimmed && !opts.mediaIds?.length) throw new Error('推文必须有文字或图片');
  if (trimmed.length > 280) throw new Error(`推文超过 280 字 (当前 ${trimmed.length})`);
  const mediaIds = (opts.mediaIds ?? []).filter(Boolean);
  if (mediaIds.length > 4) throw new Error(`一条推最多 4 张图 (当前 ${mediaIds.length})`);

  const data = await gqlPost<CreateTweetData>(
    buildCreateTweet(trimmed, mediaIds),
    { timeoutMs: 30_000 },
  );
  const result = data?.create_tweet?.tweet_results?.result;
  if (!result?.rest_id) throw new Error('CreateTweet 返回空 result');

  return {
    id: result.rest_id,
    text: result.legacy?.full_text || trimmed,
    createdAt: result.legacy?.created_at ? Date.parse(result.legacy.created_at) : Date.now(),
    url: `https://x.com/i/status/${result.rest_id}`,
  };
}
