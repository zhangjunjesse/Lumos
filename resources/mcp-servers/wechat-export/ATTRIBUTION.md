# Attribution

This module bundles third-party open-source code. The Lumos project credits and
preserves the original licenses below.

## macOS implementation

### server.py / contacts loader / MCP tool surface

Source: https://github.com/cocohahaha/wechat-decrypt-macos
License: MIT

Copyright (c) 2025 cocohahaha
Copyright (c) 2026 Lumos contributors (modifications)

Modifications by Lumos:

- `is_send` semantics — original heuristic detected the owner's `Name2Id.rowid`
  by intersecting senders across a single db's tables. That doesn't survive
  cross-db Name2Id rowid drift. We replaced it with `extract_self_wxid()` (path
  parse) + per-db `Name2Id` rowid lookup so [我]/[对方] is correct.
- Rich-media decoding — every non-text `message_content` is Zstandard-compressed
  XML. We added `message_decoder.py` to decompress and turn the XML envelopes
  into short readable summaries (`[图片 md5=… size=…B]`, `[视频 6s]`,
  `[引用 xxx『yyy』] zzz`, …) instead of leaking raw bytes into the AI prompt.

### extract_key.py — SQLCipher key extractor

Algorithm credit: https://github.com/Thearas/wechat-db-decrypt-macos (WTFPL),
which in turn credits https://github.com/ylytdeng/wechat-decrypt.

Implementation rewritten in-house against lldb's Python API to:

- Attach without requiring `csrutil disable` (only the per-app `codesign --sign -`
  step is needed; SIP stays on).
- Validate every candidate via SQLCipher 4's HMAC-SHA512 page authenticator
  rather than via spawning the `sqlcipher` CLI per candidate.
- Recover keys for every WCDB salt found in `xwechat_files/<wxid>/db_storage/`
  in a single sweep (~5–10 minutes typical), not just one.

License: WTFPL v2 (Do What The F*** You Want To Public License) for the algorithm,
       which is compatible with both MIT and the Lumos repo's terms.

## Windows implementation (Phase 3, not yet vendored)

Planned: https://github.com/alanhzw/PyWxDump (MIT) plus an in-house stdio MCP
wrapper. Will land in `resources/mcp-servers/wechat-export/windows/` when Phase 3
ships.
