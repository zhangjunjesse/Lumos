// 真实现场:XChat 后台页停在 JetFuel 登录墙时抓到的内容。
// 来源:用户机器上的 ~/.lumos/x-platform/xchat-debug/xchat-{inbox,conversation}-latest.html
// (#48 报告、#49 提供正文)。两个文件抓到的都是这张登录页 —— 屏幕上看得见会话,
// 后台自动化上下文却未登录,而解析器把这些按钮文案当成了私信内容返回。
//
// 这是 negative fixture:任何解析结果都不允许把它判成 'ok',更不许把这些行当消息。

/** debug HTML 头部注释里记录的 rawLines,逐字照抄。 */
export const LOGIN_WALL_RAW_LINES = [
  '看看正在发生什么',
  '使用手机继续',
  '使用 Google 继续',
  '通过 Google 继续操作',
  '使用 Apple 继续',
  '或',
  '电子邮箱或用户名',
  '继续',
  '继续即表示你同意我们的 服务条款、隐私政策 和 Cookie 使用政策。',
];

/** 同一份现场里抓到的 data-testid 清单。 */
export const LOGIN_WALL_TESTIDS = ['BottomBar', 'google_sign_in_container'];

/** 真会话页的样子(来自 #48 里用户在浏览器中看到的实际内容),用作 positive 对照。 */
export const REAL_CONVERSATION_RAW_LINES = ['hi', '14:24', '你好', '11:09', 'test123', '11:21'];
