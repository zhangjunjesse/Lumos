// 真实现场:XChat 已登录但停在端到端加密的 passcode 解锁页。
// 来源:用户机器的 xchat-{inbox,conversation}-latest.html(#51 以 gzip+base64 提供,
// 5982 bytes / sha256 e6e236c2…),本文件由那份 DOM 的头部注释逐字提取。
//
// 关键:侧边栏 testid(AppTabBar_*/SideNav_*/UserAvatar-*)都在 —— **已经登录了**,
// 只是解不开密文。所以必须判 locked 而不是 needs_login,否则会让一个已登录的用户
// 去反复「重新登录」(#52 就是这么被误导的)。

/** 解锁页的 data-testid 清单(逐字照抄)。 */
export const PASSCODE_PAGE_TESTIDS = [
  "BottomBar",
  "AppTabBar_Home_Link",
  "AppTabBar_Explore_Link",
  "AppTabBar_Notifications_Link",
  "AppTabBar_Follow_Link",
  "AppTabBar_DirectMessage_Link",
  "AppTabBar_Profile_Link",
  "AppTabBar_More_Menu",
  "SideNav_NewTweet_Button",
  "SideNav_AccountSwitcher_Button",
  "UserAvatar-Container-a_moment_later",
  "primaryColumn",
  "pin-title",
  "pin-code-input-container",
  "pin-forgot-pin"
];

/** 解锁页渲染出的文本行(逐字照抄)。 */
export const PASSCODE_PAGE_RAW_LINES = [
  "Enter Passcode",
  "Your passcode is required to recover your encryption keys so we can decrypt your previous messages.",
  "Forgot passcode"
];
