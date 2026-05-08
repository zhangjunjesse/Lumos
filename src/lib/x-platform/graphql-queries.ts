/**
 * X (Twitter) web GraphQL operation IDs + features 镜像。
 *
 * 这些值来自 x.com web app bundle, X 不公开承诺稳定 — webpack chunk hash 变了
 * 就要更新一次。GIT pin 一份,在评论里记录 LAST_VERIFIED 时间和来源,失效时优先
 * 改这一处。
 *
 * 抓取方法(失效时):在系统浏览器登录 x.com → DevTools → Network → 过滤 graphql
 * → 找请求 URL `/i/api/graphql/<queryId>/<OperationName>`,query_id + variables
 * + features 都拿出来更新这里。
 *
 * LAST_VERIFIED:
 *   - SearchTimeline: 2026-05-08 (用户系统浏览器抓包)
 *   - 其它 op: 2026-05 初次 pin,可能已失效,失效时按"抓取方法"更新
 */

import type { GraphQLGetInput, GraphQLPostInput } from './graphql-client';

// 通用 features map — SearchTimeline 实测在用的完整集 (2026-05-08)。X 服务器
// 缺 feature 时常返 422 / 404, 多余 feature 一般忽略, 因此用最大集做 default。
// 不同 op 偶尔需要额外字段, 在对应 builder 里 spread + 追加。
const COMMON_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

export const VIEWER: GraphQLGetInput = {
  queryId: '-876iyxD1O_0X0BqeykjZA',
  operationName: 'Viewer',
  variables: {
    withCommunitiesMemberships: true,
  },
  features: {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  },
};

export function buildSearchTimeline(query: string, count = 20, cursor?: string): GraphQLGetInput {
  return {
    queryId: 'H-VVabCSH1rAQa4QJXLcVA',
    operationName: 'SearchTimeline',
    variables: {
      rawQuery: query,
      count,
      ...(cursor ? { cursor } : {}),
      querySource: 'typed_query',
      product: 'Top',
      withGrokTranslatedBio: true,
    },
    features: COMMON_FEATURES,
  };
}

export function buildHomeTimeline(count = 20, cursor?: string): GraphQLPostInput {
  return {
    queryId: 'HCosKfLNW1AcOo3la3mMgg',
    operationName: 'HomeTimeline',
    variables: {
      count,
      ...(cursor ? { cursor } : {}),
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: 'launch',
    },
    features: COMMON_FEATURES,
  };
}

export function buildUserTweets(userId: string, count = 20, cursor?: string): GraphQLGetInput {
  return {
    queryId: 'V7H0Ap3_Hh2FyS75OCDO3Q',
    operationName: 'UserTweets',
    variables: {
      userId,
      count,
      ...(cursor ? { cursor } : {}),
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: false,
      withVoice: true,
      withV2Timeline: true,
    },
    features: COMMON_FEATURES,
  };
}

export function buildCreateTweet(text: string, mediaIds: string[] = []): GraphQLPostInput {
  return {
    queryId: 'SoVnbfCycZ7fERGCwpZkYA',
    operationName: 'CreateTweet',
    variables: {
      tweet_text: text,
      dark_request: false,
      media: {
        media_entities: mediaIds.map((id) => ({ media_id: id, tagged_users: [] })),
        possibly_sensitive: false,
      },
      semantic_annotation_ids: [],
    },
    features: COMMON_FEATURES,
  };
}
