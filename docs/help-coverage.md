# 模型註釋與說明書對照

`lib/help-content.ts` 的 `HELP_USAGE` 將內容分為 `model` 與 `guide-only`。
`HelpTip` 僅接受 `ModelHelpKey`；新增一般欄位不能直接插入提示圖示。
說明書 `/guide` 保留完整詞彙及操作資訊，沿用登入保護與首頁／頁首入口。

| 畫面 | 模型註釋（畫面 ⓘ） | 僅供說明書（畫面不放 ⓘ） |
| --- | --- | --- |
| 首頁摘要／控制 | In play 的 Priority 門檻 | Winning、Behind、Streams、League、Week、日期、時區、隊伍 |
| 推薦 | 依實際 scoreType 的 Swing／Net FP／Roto gain、Confidence、Lineup、Helps／Watch | 排名、姓名、位置、球隊、Game、樣本期間、PTS／REB／AST／STL／BLK／TO／3PM |
| 週報 | Result 1–4 模型級距、Priority | 分類名稱、兩隊比分、Higher／Lower wins |
| Matchups／球員週明細 | 無 | 分類、GP、球員資訊、熱圖、期間、缺值、「—／*」、隊伍切換 |
| 傷病 | 區塊標題的重要性與受益門檻、推薦分數、復出與角色下降推估 | 原始標記、基本場數／分鐘定義、紀錄期限與忽略操作 |
| 選秀 | Score、Confidence、Fit、Scarcity、Estimated return、Price／Value／Max bid、模型建議 Slot、模型 Why、分類 z、陣容百分位／Auto punt | ADP、AAV、總順位、輪次、隊數、預算、位置、同步、Draft／Taken、Reset／Undo |
| 共用狀態／Raw Data | 無 | 快取、Refresh、備援時間、Demo、資料狀態、JSON |

## 避免重複

- 每種指標優先在表頭或區塊標題解釋；推薦／傷病分數依實際 `scoreType` 判斷單位。
- 單位相同時僅放一個表頭／區塊提示。混合單位時，表頭說明混合情況，個別值另附自己的單位說明。
- legacy／blended z-score 屬同類單位，不因來源型別不同就重複提示。
- 傷病卡片保留基準、分鐘變化及理由文字，不在每張卡重複通用門檻提示。
- 選秀詳細資訊作為獨立區域保留模型說明及個別 Confidence 證據；ADP fallback 改為「Yahoo rank 代理，非 ADP」文字。

## 必要文字與口徑

- 推薦表上方明示「以下為單場預估，非當週實績」，但基礎統計欄名不加提示。
- 缺值、部分比率、備援資料時間及來源不完整警示直接顯示；移除圖示不會移除警示。
- 球員週明細保留整週 NBA 成績口徑與「球員加總不一定等於球隊週報比分」。
- 不改任何模型公式、API 數據、原始 JSON、統計欄位、權限或 Yahoo 請求。

## 驗證

測試檢查基礎欄位／控制項沒有提示、畫面所有提示均屬模型主題、同質／混合分數單位正確，並涵蓋滑鼠、鍵盤、觸控、排序、表格捲動、手機溢出、必要警示及說明書登入保護。
