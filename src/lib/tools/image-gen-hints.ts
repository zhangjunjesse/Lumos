export const IMAGE_GEN_IN_PROCESS_HINT = `About image generation (generate_image tool from lumos-image):
- When user asks to draw/generate/create/edit/restyle images, call the tool directly without asking for confirmation.
- Do not output fenced planning blocks like \`image-gen-request\` or \`batch-plan\`.
- The prompt parameter must be a detailed English description.
- Understand Chinese size descriptions: "宽屏/横版" → 16:9, "竖版/手机壁纸" → 9:16, "高清" → 2K, "超高清" → 4K.
- After calling the tool, ALWAYS embed generated images using the \`url\` field from tool_result: ![description](url). Never use the \`path\` field for display.
- For editing existing images, describe only the changes in the prompt and pass the original image path via reference_image_paths.
- To edit the previously generated image, find the image path from the prior tool_result and pass it as reference_image_paths.
- For batch requests, make multiple independent calls. Report progress after each (e.g. "3/5 done").
- Maximum 10 images per conversation. The tool_result contains generation_count/generation_limit for tracking.
- When batch requests exceed 5 images, tell the user the expected count and approximate time (~15-30s each), then wait for confirmation before starting.
- When approaching the limit (8th-9th image), proactively inform the user about remaining quota.
- After reaching the limit, suggest starting a new conversation to continue.
- If the tool returns an error about missing provider config, tell the user to configure it in Settings → Providers → Image Generation.
- If user asks to send generated files to Feishu, include \`FEISHU_SEND_FILE::<absolute_path>\` on separate lines.

Advanced features (DashScope Wanxiang 2.7):
- Sequential group mode (enable_sequential=true, count=2-4): generates multiple images with consistent characters/style. Use when user asks for "连续插图", "多角度", "一致性组图", "绘本", "故事板", or multiple views of the same subject.
- Color palette (color_palette): controls the color scheme. Use when user specifies colors like "暖色调", "蓝白配色", or provides hex codes.
- Region editing (region_edit_bbox + reference_image_paths): modifies only specific areas of an image. Coordinates are [x1,y1,x2,y2] in pixels. Use when user says "只改这部分", "局部修改", or points to a specific area.
- Thinking mode (thinking_mode): enabled by default. Improves creative quality and prompt understanding. Only disable if user explicitly asks for faster generation.
- Resolution: 1K for quick previews, 2K for quality output, 4K for print/professional use (pro model only, slower).`;
