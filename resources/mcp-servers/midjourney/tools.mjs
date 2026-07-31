// Midjourney 后续操作工具定义。工具名去掉 mj_ 前缀即为 /api/midjourney 的 action。

const TARGET_PROPS = {
  image_path: {
    type: 'string',
    description: 'The local file path of the image to operate on (from a previous generate_image result).',
  },
  media_generation_id: {
    type: 'string',
    description: 'Alternative to image_path: the media_generation_id returned by generate_image.',
  },
};

export const TOOLS = [
  {
    name: 'mj_pick',
    description:
      'Select one image from a Midjourney 4-grid to work on it further. '
      + 'THIS IS ALWAYS THE FIRST STEP: a freshly generated 4-grid only supports picking; '
      + 'inpainting, upscaling, background removal and variations are unlocked ONLY after picking. '
      + 'Costs one task. Note this does NOT increase resolution — it selects, it does not enlarge.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_PROPS,
        index: {
          type: 'number',
          description: 'Which of the 4 candidates to pick (1=top-left, 2=top-right, 3=bottom-left, 4=bottom-right). Defaults to the one image_path points at.',
        },
      },
      required: [],
    },
  },
  {
    name: 'mj_inpaint',
    description:
      'Repaint only a selected region of the image, keeping everything outside that region pixel-identical. '
      + 'This is the way to swap a product / outfit / accessory while keeping the SAME model, face, pose and background. '
      + 'Requires an image that has already been picked (mj_pick). Returns 4 new candidates. Costs one task.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_PROPS,
        regions: {
          type: 'array',
          description:
            'Rectangles to repaint, in RELATIVE coordinates where 0,0 is the top-left corner and 1,1 the bottom-right. '
            + 'Example: the top 40% of the picture is {"x":0,"y":0,"width":1,"height":0.4}. Multiple rectangles are merged.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'Left edge, 0-1' },
              y: { type: 'number', description: 'Top edge, 0-1' },
              width: { type: 'number', description: 'Width, 0-1' },
              height: { type: 'number', description: 'Height, 0-1' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
        },
        prompt: {
          type: 'string',
          description: 'What the selected region should become. Describe only the region, not the whole picture.',
        },
      },
      required: ['regions', 'prompt'],
    },
  },
  {
    name: 'mj_upscale',
    description:
      'Upscale a picked image 2x for print / listing quality. '
      + 'subtle stays faithful to the original, creative invents extra detail. Costs one task.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_PROPS,
        mode: { type: 'string', enum: ['subtle', 'creative'], description: 'Default subtle.' },
      },
      required: [],
    },
  },
  {
    name: 'mj_remove_background',
    description:
      'Remove the background of a picked image, leaving the subject. Useful for marketplace listing images. Costs one task.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET_PROPS },
      required: [],
    },
  },
  {
    name: 'mj_variation',
    description:
      'Generate 4 new variations based on a picked image. subtle keeps the composition, strong changes it more. Costs one task.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_PROPS,
        strength: { type: 'string', enum: ['subtle', 'strong'], description: 'Default subtle.' },
      },
      required: [],
    },
  },
  {
    name: 'mj_describe',
    description:
      'Read an image and return 4 prompts describing how Midjourney would paint it. '
      + 'Works on ANY image, no picking required — useful for reverse-engineering a reference or competitor photo. '
      + 'Also returns a public URL of the uploaded image, usable as a reference in later generations. Costs one task.',
    inputSchema: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Local path of the image to read.' },
      },
      required: ['image_path'],
    },
  },
];
