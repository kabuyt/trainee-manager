const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
        HeadingLevel } = require("docx");

// A4 dimensions in DXA
const A4_W = 11906;
const A4_H = 16838;
const MARGIN = 1134; // ~2cm
const CONTENT_W = A4_W - MARGIN * 2; // ~9638

const FONT = "MS Gothic";
const FONT_MINCHO = "MS Mincho";

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function heading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({ text: "■ ", font: FONT, size: 20, bold: true, color: "1E3A5F" }),
      new TextRun({ text, font: FONT, size: 20, bold: true, color: "1E3A5F" }),
    ],
  });
}

function bodyText(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    indent: opts.indent ? { left: 360 } : undefined,
    children: [new TextRun({ text, font: FONT, size: 18, ...opts })],
  });
}

function bulletItem(label, desc) {
  return new Paragraph({
    spacing: { before: 20, after: 20 },
    indent: { left: 480 },
    children: [
      new TextRun({ text: "・", font: FONT, size: 18 }),
      new TextRun({ text: label, font: FONT, size: 18, bold: true }),
      new TextRun({ text: desc, font: FONT, size: 18 }),
    ],
  });
}

// Evaluation table
const evalColW = [CONTENT_W * 0.15, CONTENT_W * 0.15, CONTENT_W * 0.7];
const evalColDXA = evalColW.map(w => Math.round(w));

function evalRow(grade, pct, desc, shade) {
  const cellMargins = { top: 40, bottom: 40, left: 80, right: 80 };
  return new TableRow({
    children: [
      new TableCell({
        borders, width: { size: evalColDXA[0], type: WidthType.DXA },
        shading: shade ? { fill: "E8EDF5", type: ShadingType.CLEAR } : undefined,
        margins: cellMargins,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: grade, font: FONT, size: 18, bold: true })] })],
      }),
      new TableCell({
        borders, width: { size: evalColDXA[1], type: WidthType.DXA },
        shading: shade ? { fill: "E8EDF5", type: ShadingType.CLEAR } : undefined,
        margins: cellMargins,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: pct, font: FONT, size: 18 })] })],
      }),
      new TableCell({
        borders, width: { size: evalColDXA[2], type: WidthType.DXA },
        shading: shade ? { fill: "E8EDF5", type: ShadingType.CLEAR } : undefined,
        margins: cellMargins,
        children: [new Paragraph({ children: [new TextRun({ text: desc, font: FONT, size: 18 })] })],
      }),
    ],
  });
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: FONT, size: 18 } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: A4_W, height: A4_H },
        margin: { top: MARGIN, right: MARGIN, bottom: 800, left: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 60 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "1E3A5F", space: 4 } },
            children: [
              new TextRun({ text: "GROP VIETNAM Co., Ltd.", font: FONT, size: 16, color: "64748B" }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1", space: 4 } },
            spacing: { before: 60 },
            children: [
              new TextRun({ text: "ご不明な点がございましたら担当者までお問い合わせください。", font: FONT, size: 16, color: "64748B" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "GROP VIETNAM Co., Ltd.", font: FONT, size: 14, color: "94A3B8" }),
            ],
          }),
        ],
      }),
    },
    children: [
      // Title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1E3A5F", space: 6 } },
        children: [
          new TextRun({ text: "「教育課程　個人成績書」の見方", font: FONT, size: 28, bold: true, color: "1E3A5F" }),
        ],
      }),

      // 1. Basic info
      heading("基本情報"),
      bodyText("受入企業名、実習生の氏名（日本語・ローマ字）、生年月日、年齢、受験日、顔写真を記載しています。", { indent: true }),

      // 2. Test scores
      heading("テスト成績"),
      bodyText("使用教材「みんなの日本語」の進度に応じた月間テストの結果です。", { indent: true }),
      bulletItem("語彙（100点満点）", "：単語の読み書きに関する問題"),
      bulletItem("文法（100点満点）", "：文の組み立て・助詞の使い方など"),
      bulletItem("聴解（100点満点）", "：日本語音声の聞き取り問題"),
      bulletItem("会話（100点満点）", "：講師との面談による口頭評価"),
      bulletItem("合計（400点満点）", "：上記4科目の合計点"),
      new Paragraph({ spacing: { before: 60, after: 20 }, indent: { left: 360 }, children: [
        new TextRun({ text: "また、同期受験者全体の", font: FONT, size: 18 }),
        new TextRun({ text: "平均点", font: FONT, size: 18, bold: true }),
        new TextRun({ text: "、学力の相対的な位置を示す", font: FONT, size: 18 }),
        new TextRun({ text: "偏差値", font: FONT, size: 18, bold: true }),
        new TextRun({ text: "（50が平均、60以上が優秀）、", font: FONT, size: 18 }),
        new TextRun({ text: "順位", font: FONT, size: 18, bold: true }),
        new TextRun({ text: "も併記しています。", font: FONT, size: 18 }),
      ]}),

      // 3. Evaluation
      heading("総合評価"),
      bodyText("日本語能力と学習態度をそれぞれ4段階で評価しています。", { indent: true }),
      new Paragraph({ spacing: { before: 60 } }),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: evalColDXA,
        rows: [
          evalRow("評価", "目安", "説明", true),
          evalRow("優", "80%以上", "大変優れた成績・態度である"),
          evalRow("良", "60%以上", "一定の水準に達している"),
          evalRow("可", "40%以上", "基本的な理解はあるが努力が必要"),
          evalRow("不可", "40%未満", "大幅な改善が求められる"),
        ],
      }),

      // 4. Diagnostic comments
      heading("診断コメント"),
      bodyText("テスト結果の詳細な分析に基づき、学習上の強みや課題を記載しています。苦手分野の特定や今後の学習方針の参考としてご活用ください。", { indent: true }),

      // 5. Score trend
      heading("成績推移（グラフ）"),
      bodyText("月ごとの科目別得点の変化を折れ線グラフで表示しています。学習の伸びや課題のある科目が一目で確認できます。", { indent: true }),

      // 6. Life & Learning
      heading("生活状況・学習状況"),
      bodyText("実習生の生活面・学習面について、以下の4つの観点から記載しています。", { indent: true }),
      bulletItem("Good", "：良い点・評価できる行動"),
      bulletItem("Bad", "：改善が必要な点・注意事項"),
      bulletItem("対策", "：講師が現在行っている指導内容"),
      bulletItem("改善点", "：今後の課題と改善の方向性"),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = process.argv[2] || "guide.docx";
  fs.writeFileSync(outPath, buffer);
  console.log("Created: " + outPath);
});
