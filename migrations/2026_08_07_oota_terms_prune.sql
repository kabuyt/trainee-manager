-- オオタ専門用語の断片カード12枚を削除（2026-08-07・REST適用済み、記録用）
-- 仕様表の「答えセル」が単語として登録されていたもの。内容は親カードの
-- noteJa/noteVi（解説）として data/oota-vocab.js に統合済み（70語→58語）。
DELETE FROM terminology_terms WHERE id IN (
  'oota-paint-052', -- 粉体・溶剤共 → 1コート1ベーク仕様の解説へ
  'oota-paint-053', -- 単位 μm → 膜厚の解説へ
  'oota-paint-054', -- 単位 GU → グロスの解説へ
  'oota-paint-055', -- △E → 色差の解説へ
  'oota-paint-061', -- ウレタン・エポキシ等 → 液化重合仕様の解説へ
  'oota-paint-062', -- 溶剤が主で粉体もある → 2コート2ベーク仕様の解説へ
  'oota-paint-063', -- 表記 100/100 → 碁盤目試験の解説へ
  'oota-paint-064', -- 単位 mm → カッピング試験・屈曲試験の解説へ
  'oota-paint-065', -- 1h/サイクル数 → 沸水試験の解説へ
  'oota-paint-066', -- 単位 h → 塩水噴霧試験の解説へ
  'oota-paint-067', -- 単位は無い → アルコール検査の解説へ
  'oota-paint-068'  -- JIS Z 1522準拠 → 密着試験の解説へ
);
