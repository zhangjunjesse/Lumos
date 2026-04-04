import PptxGenJS from 'pptxgenjs';

export interface SlideTextItem {
  text: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface SlideTableData {
  headers: string[];
  rows: string[][];
  x?: number;
  y?: number;
  w?: number;
}

export interface SlideContent {
  title?: string;
  subtitle?: string;
  texts?: SlideTextItem[];
  table?: SlideTableData;
  background?: { color: string };
}

export interface CreatePptOptions {
  filePath: string;
  title?: string;
  author?: string;
  slides: SlideContent[];
  layout?: '16x9' | '4x3';
}

function addTextToSlide(slide: PptxGenJS.Slide, item: SlideTextItem): void {
  slide.addText(item.text, {
    x: item.x ?? 0.5,
    y: item.y ?? 0.5,
    w: item.w ?? 9,
    h: item.h,
    fontSize: item.fontSize ?? 14,
    bold: item.bold,
    italic: item.italic,
    color: item.color?.replace('#', '') ?? '333333',
    align: item.align ?? 'left',
  });
}

function addTableToSlide(slide: PptxGenJS.Slide, data: SlideTableData): void {
  const headerRow = data.headers.map((h) => ({
    text: h,
    options: { bold: true, fill: { color: 'E8E8E8' } },
  }));
  const bodyRows = data.rows.map((row) =>
    row.map((cell) => ({ text: cell })),
  );

  slide.addTable([headerRow, ...bodyRows], {
    x: data.x ?? 0.5,
    y: data.y ?? 1.5,
    w: data.w ?? 9,
    border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
    fontSize: 11,
    autoPage: true,
  });
}

export async function createPpt(options: CreatePptOptions): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.author = options.author || 'Lumos';
  pptx.title = options.title || 'Presentation';

  if (options.layout === '4x3') {
    pptx.layout = 'LAYOUT_4x3';
  } else {
    pptx.layout = 'LAYOUT_16x9';
  }

  for (const content of options.slides) {
    const slide = pptx.addSlide();

    if (content.background) {
      slide.background = { color: content.background.color.replace('#', '') };
    }

    if (content.title) {
      slide.addText(content.title, {
        x: 0.5,
        y: 0.3,
        w: '90%',
        fontSize: 28,
        bold: true,
        color: '222222',
      });
    }

    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: 0.5,
        y: 1.0,
        w: '90%',
        fontSize: 16,
        color: '666666',
      });
    }

    if (content.texts) {
      for (const item of content.texts) {
        addTextToSlide(slide, item);
      }
    }

    if (content.table) {
      addTableToSlide(slide, content.table);
    }
  }

  await pptx.writeFile({ fileName: options.filePath });
  return options.filePath;
}
