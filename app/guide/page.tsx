import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { isPageAuthenticated } from "@/lib/auth";
import { HELP, STAT_DEFINITIONS } from "@/lib/help-content";

export const dynamic = "force-dynamic";
export const metadata = { title: "使用說明書 | Fantasy Basketball Desk" };
export default async function GuidePage() {
  if (!(await isPageAuthenticated())) redirect("/login");
  const groups = [...new Set(Object.values(HELP).map((entry) => entry[0]))];
  return <main className="min-h-screen" lang="zh-Hant">
    <AppHeader />
    <article className="guide-page workspace-shell">
      <header className="guide-intro"><p className="eyebrow">Fantasy Basketball Desk / Guide</p><h1>使用說明書</h1><p>先看資料口徑，再判讀數字。各頁的 ⓘ 可用滑鼠移入、鍵盤聚焦或手機點擊查看；Escape、再次點擊或點擊外部可關閉。</p><Link href="/" className="guide-link">← 返回儀表板</Link></header>
      <nav className="guide-toc" aria-label="說明書目錄"><h2>目錄</h2><a href="#start">快速開始與各頁操作</a>{groups.map((group, index) => <a key={group} href={`#section-${index}`}>{group}</a>)}<a href="#stat-glossary">統計分類詞彙</a><a href="#faq">常見問題</a></nav>
      <section id="start" className="guide-section"><h2>快速開始與各頁操作</h2><ol>
        <li>選擇獲授權的聯盟、週次、目標日期及時區。日期與週次是不同控制項，查看推薦時請確認兩者符合需求。</li>
        <li>Recommendations 查看可取得球員的預估補強價值，配合 Lineup、Confidence、Helps 與 Watch 判讀；點擊欄名可排序。</li>
        <li>Weekly Report 查看球隊的實際週分類比分，Your team 可切換隊伍；下方展開「球員當週數據」查看雙方球員整週 NBA 實績。</li>
        <li>Matchups 的 View／Selected 會開啟該場 Weekly Report；熱圖比較同分類的球隊數據，Raw Data 提供正規化原始回應。</li>
        <li>傷病區分精選與觀察，復出提醒需要本瀏覽器先前紀錄；所有建議需自行評估，不自動加人或丟人。</li>
        <li>Draft Assistant 先確認選秀模式、順位、隊數及是否同步 Yahoo。Mock mode 的 Draft／Taken、Reset／Undo 只操作本站模擬紀錄；同步模式不接受手動選人。</li>
      </ol><p>實際數據與預估數據不可混用：週報是 Fantasy 隊伍比分，球員明細是整週 NBA 實績，推薦表則是模型預估，三者不一定能直接相加或互相比較。</p></section>
      {groups.map((group, index) => <section className="guide-section" id={`section-${index}`} key={group}><h2>{group}</h2><dl>{Object.entries(HELP).filter(([, entry]) => entry[0] === group).map(([key, entry]) => <div id={key} key={key}><dt>{entry[1]}</dt><dd>{entry[2]}</dd></div>)}</dl></section>)}
      <section className="guide-section" id="stat-glossary"><h2>統計分類詞彙</h2><p>以下為支援辨識的 Yahoo NBA stat ID。實際啟用分類以聯盟設定為準；自訂或未知分類會顯示缺少專屬定義，不推測公式。推薦欄為單場估計、週明細為對戰期間累計，週報為 Fantasy 球隊比分。</p><dl>{Object.entries(STAT_DEFINITIONS).map(([id, entry]) => <div id={`stat-${id}`} key={id}><dt>{entry[0]} <small>Yahoo stat ID {id}</small></dt><dd>{entry[1]}</dd></div>)}</dl></section>
      <section className="guide-section" id="faq"><h2>常見問題</h2><dl>
        <div><dt>為什麼 Refresh 暫時不能按？</dt><dd>相同來源成功更新後有 60 秒冷卻；載入中也會暫停操作。等待倒數結束再更新，限流時依畫面提示重試。</dd></div>
        <div><dt>為什麼沒有數據或顯示 —？</dt><dd>可能是未來週、缺少來源、分類不支援或請求失敗。請看錯誤、備援時間與缺值日期，不把缺值當零。</dd></div>
        <div><dt>為什麼球員加總和隊伍比分不同？</dt><dd>球員明細涵蓋曾在隊上球員的整週 NBA 表現，包括板凳和不在隊上期間；Yahoo Fantasy 比分另依有效陣容計算。</dd></div>
        <div><dt>為什麼我看不到某個聯盟？</dt><dd>登入身分限制可見聯盟，且必須是授權 Yahoo 帳號可取得的聯盟；說明書不會擴大權限。</dd></div>
        <div><dt>這些建議會幫我操作 Yahoo 嗎？</dt><dd>不會。補人、釋出與模擬選秀均為本站資訊或紀錄；實際交易與選秀請在 Yahoo 確認。</dd></div>
      </dl><Link className="guide-link" href="/">返回儀表板</Link></section>
    </article>
  </main>;
}
