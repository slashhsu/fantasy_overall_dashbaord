# 全站指標與註釋對照

字典：`lib/help-content.ts`；浮層：`components/help-tip.tsx`；登入保護說明書：`/guide`。
短註釋及說明書共用字典。除個別值的來源、缺值或特殊計算外，同欄以欄名說明，避免重複每格。

| 畫面 | 覆蓋項目 | 字典／上下文 |
| --- | --- | --- |
| 首頁與篩選 | League、Week、日期、時區、Matchup、Your team | league、week、date、timezone、matchup |
| 摘要 | Winning、Behind、In play、Streams、Live／Cached／Backup | winning、inPlay、streams、cache |
| 推薦表 | 排名、球員／NBA／位置、Game、模型／賽程狀態、Confidence、Lineup、Helps／Watch、樣本期間 | rank、player、game、demo、partial、confidence、lineup、helps、projections |
| 推薦分數 | Swing、Net FP、Roto gain；個別 scoreType | swing、netFp、rotoGain、scoreTopic 對應 probability／expectedCategories／categoryFit |
| 推薦數據 | PTS、REB、AST、STL、BLK、3PM、TO | StatHelp projection；單場估計，不是週實績 |
| 週報 | 分類名稱與兩隊比分、Result 級距、Priority、Direction | StatHelp matchup、teamWeekly、scoreResult、priority、direction |
| 對戰 | 每分類兩隊數值、熱圖、View／Selected | StatHelp matchup、heatmap、matchup |
| 球員週明細 | GP／聯盟分類、NBA／位置、日期期間、累計／比率、缺值日期、部分比率 * | weekly、StatHelp weekly、player、missing |
| 傷病 | 精選／觀察、28／24／5 分鐘門檻、場數、標記、分數、可信度、復出、忽略與儲存期限 | injury、injuryMinutes、injuryStatus、scoreTopic、returns、injuryHistory |
| 選秀設定 | 聯盟、順位、隊數、模式、預算、Yahoo 同步／模擬、Reset | league、draftSettings、draftMode、draftActions |
| 選秀摘要 | 總順位、輪次、距離下輪、陣容人數／容量、剩餘球員、來源／同步時間 | draftTurn、partial、cache |
| 選秀表與詳細 | 排名、ADP／Yahoo rank 代理、Score、Confidence、Fit、Scarcity、Return、AAV、Price／Value／Max bid、Slot／Why／Pick、分類 z | rank、adp、draftScore、confidence、fit、scarcity、estimatedReturn、aav、price、draftSlot、zScore |
| 選秀側欄與對話框 | 分類百分位、T／B／P、Auto punt、聯盟預算、My team、Recent picks、Undo、得標隊伍與金額 | strategy、StatHelp projection、price、draftTurn、draftActions、draftSlot |
| 共用狀態 | Refresh 冷卻、取得時間、備援、Demo、驗證／部分資料 | refresh、cache、partial、demo |
| Raw Data | 查詢範圍、對戰／分類、預估、賽程、模型與時間、null／0／缺欄 | raw、missing；JSON 原樣保留 |

## 口徑核對

- Swing 依 `scoreType` 說明實際單位；+0.050 的機率差為 +5 百分點，預期分類數不可轉成整場勝率。
- Confidence、Fit、Scarcity 不是命中率；Estimated return 是下輪仍可選的推估機率。
- Result 的 1–4 是模型標準化分差級距；Priority 是規則權重；In play 為 Priority ≥2.75，與領先／落後重疊。
- 比率、次數、場數、分鐘分別解釋；未知分類明示缺少專屬定義。
- 推薦、Fantasy 隊伍週比分、球員整週 NBA 實績不可混用。欄名與資料列必須保持一致（包含 REB）。
- 說明書及提示只讀本地內容；不呼叫任何 Yahoo 或資料 API。說明書沿用新版 session 驗證，且不擴大聯盟授權。

## 驗收

測試包含 hover、focus、觸控點擊、Escape／再次點擊／外部關閉、portal 不被捲動容器裁切、排序及選取不受干擾、桌面與手機視窗邊界、說明書登入保護及無額外資料請求。

傷病候選增加可選 `scoreType` 元資料，沿用原推薦分數型別，僅用於選取註釋單位，不改計分。
