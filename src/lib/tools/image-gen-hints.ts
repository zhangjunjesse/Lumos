export const IMAGE_GEN_IN_PROCESS_HINT = `About image generation (lumos-image MCP server):
- The exact tool name registered with the SDK is \`mcp__lumos-image__generate_image\`. Some SDK logs also refer to it as \`generate_image\` — they mean the same tool. Call it by either name.
- When user asks to draw/generate/create/edit/restyle images, call the tool directly without asking for confirmation. Describing what you WOULD generate without actually calling the tool is a workflow failure.
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
- Resolution: 1K for quick previews, 2K for quality output, 4K for print/professional use (pro model only, slower).

Advanced features (Gemini gemini-3.1-flash-image-preview / gemini-3-pro-image-preview):
- Multi-reference editing: pass multiple paths in reference_image_paths to remix, combine subjects, or transfer style across several references.
- Aspect ratios: supports 10 ratios natively — 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9. Unsupported ratios fall back to 1:1 with a warning.
- Resolution: 1K/2K/4K all supported.
- Parallel generation: count>1 triggers parallel API calls (Gemini allows only 1 image per call natively — handled transparently).
- Negative prompt (negative_prompt): describe what to EXCLUDE, e.g. "no text, no watermark, cartoon style". Synthesized into the prompt since the API has no dedicated field.
- Color palette (color_palette): works the same way as DashScope — hex codes or color names, injected as natural-language guidance.
- Region editing (region_edit_bbox + reference_image_paths): bbox coordinates are injected as natural-language instructions ("modify ONLY [x1,y1,x2,y2]"); works best with clear, non-overlapping regions.
- Sequential consistency (enable_sequential=true): injects character/style-consistency guidance into the prompt.
- Safety settings (safety_settings): advanced — array of {category, threshold} to override Gemini's default content filters. Only use if user explicitly asks to relax safety for e.g. medical/artistic content. Valid categories: HARM_CATEGORY_HATE_SPEECH / DANGEROUS_CONTENT / HARASSMENT / SEXUALLY_EXPLICIT / CIVIC_INTEGRITY. Thresholds: BLOCK_LOW_AND_ABOVE / BLOCK_MEDIUM_AND_ABOVE / BLOCK_ONLY_HIGH / BLOCK_NONE / OFF.
- Not supported: thinking_mode (DashScope-specific — ignored on Gemini).`;
