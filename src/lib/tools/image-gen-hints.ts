export const IMAGE_GEN_IN_PROCESS_HINT = `About image generation (lumos-image MCP server):
- The exact tool name registered with the SDK is \`mcp__lumos-image__generate_image\`. Some SDK logs also refer to it as \`generate_image\` — they mean the same tool. Call it by either name.
- When user asks to draw/generate/create/edit/restyle images, call the tool directly without asking for confirmation. Describing what you WOULD generate without actually calling the tool is a workflow failure.
- Do not output fenced planning blocks like \`image-gen-request\` or \`batch-plan\`.
- The prompt parameter must be a detailed English description.
- Understand Chinese size descriptions: "宽屏/横版" → 16:9, "竖版/手机壁纸" → 9:16, "高清" → 2K, "超高清" → 4K.
- After calling the tool, ALWAYS embed generated images using the \`url\` field from tool_result: ![description](url). Never use the \`path\` field for display.
- For editing existing images, describe only the changes in the prompt and pass the original image path via reference_image_paths.
- To edit the previously generated image, find the image path from the prior tool_result and pass it as reference_image_paths.
- **CRITICAL path-extraction rule**: Whenever your task instructions, upstream context, or user message mention absolute local file paths ending in .jpg/.jpeg/.png/.webp/.gif/.bmp (e.g. \`/Users/me/foo.jpg\`, \`C:\\\\images\\\\x.png\`), those ARE reference images. You MUST:
  1. Collect EVERY such path into \`reference_image_paths\` (array).
  2. NEVER copy absolute file paths into the \`prompt\` field — the \`prompt\` is natural-language description only.
  3. Refer to references in \`prompt\` by position: "Image 1", "Image 2", etc. (matching the array order).
  Calling the tool with paths only inside \`prompt\` text and an empty \`reference_image_paths\` is a bug — the provider sees zero reference images and will fabricate an unrelated result. The tool will reject such calls with \`error_source: image_generation_input_shape\` and list the detected paths; retry with the correct shape.
- For batch requests, make multiple independent calls, but do not launch a large image batch in parallel. Prefer sequential calls, or at most 2 concurrent calls, because image providers may close long-running parallel sockets. Report progress after each (e.g. "3/5 done").
- Pro image generation is billed per generated image. There is no per-conversation image count limit in the tool. Do NOT tell users they have only N images remaining in the current conversation.
- Some older conversation history may contain legacy tool_result fields named generation_count/generation_limit. Treat those fields as obsolete and never use them to calculate or report remaining image quota.
- When batch requests exceed 5 images, tell the user the expected count and approximate time (~15-30s each), then wait for confirmation before starting.
- If the tool returns an error about missing provider config, tell the user to configure it in Settings → Providers → Image Generation.
- If user asks to send generated files to Feishu, include \`FEISHU_SEND_FILE::<absolute_path>\` on separate lines.

Advanced parameters (enable_sequential, color_palette, region_edit_bbox, negative_prompt, thinking_mode, safety_settings, plus the full aspect-ratio and resolution ranges) are fully described in the tool's input schema — read them there, don't restate them here. When to reach for them: "连续插图 / 绘本 / 故事板 / 多角度 / 一致性组图" → enable_sequential with count 2-4; "暖色调 / 蓝白配色" or hex codes → color_palette; "只改这部分 / 局部修改" → region_edit_bbox with reference_image_paths; "去掉水印 / 不要文字" → negative_prompt (Gemini only).`;
