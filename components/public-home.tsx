import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, ClipboardList, ShieldCheck, Trophy, Users } from "lucide-react";

const features = [
  { icon: CalendarDays, title: "每週分類報告", text: "依聯盟週次查看分類比分與補強優先順序，切換對戰，深入了解雙方球員的當週表現。" },
  { icon: BarChart3, title: "每日補人分析", text: "結合分類需求、NBA 賽程與陣容條件，評估可取得球員的補強價值，並呈現模型理由及資料可信度。" },
  { icon: Users, title: "傷病機會與復出觀察", text: "依重要球員的缺陣狀態與替補上場時間變化篩選機會；主力回歸時，協助重新評估替補角色。" },
  { icon: ClipboardList, title: "選秀輔助", text: "參考隊伍適配、位置稀缺性與市場順位，模擬選人與競價預算，建立自己的 Fantasy 籃球陣容。" },
];
export function PublicHome() {
  return <main className="public-home" lang="zh-Hant">
    <header className="public-header"><Link href="/" className="public-brand"><Trophy size={24} aria-hidden="true" />Fantasy Basketball Desk</Link><Link href="/login" className="public-login" rel="nofollow">登入工作區 <ArrowRight size={16} aria-hidden="true" /></Link></header>
    <div className="workspace-shell public-content">
      <section className="public-hero" aria-labelledby="public-home-title">
        <div><p className="eyebrow">Fantasy Basketball / Courtside intelligence</p><h1 id="public-home-title">看懂對戰，<br />找到下一位補強球員。</h1><p className="public-lead">為 Yahoo Fantasy Basketball 玩家打造的分析工作區。從每週分類報告、每日補人評估到選秀模擬，把球隊決策需要的資訊放在一起。</p><Link href="/login" className="public-cta" rel="nofollow">登入 Fantasy Basketball Desk <ArrowRight size={18} aria-hidden="true" /></Link><p className="public-note">登入後僅能查看獲授權的聯盟；網站不會自動加人或丟人。</p></div>
        <div className="public-ball arena-emblem" aria-hidden="true" />
      </section>
      <section className="public-features" aria-labelledby="public-features-title"><p className="eyebrow">Your fantasy playbook</p><h2 id="public-features-title">從週報到選秀，掌握球隊需求</h2><div className="public-feature-grid">{features.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={25} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="public-privacy"><ShieldCheck size={28} aria-hidden="true" /><div><h2>公開介紹，私人工作區</h2><p>此頁只介紹功能，不公開任何聯盟名單、球隊陣容或比賽資料。儀表板、選秀、使用說明書與資料 API 均維持登入與權限檢查。模型推估不保證賽事結果，請配合資料時間與實際比賽狀況判讀。</p></div></section>
      <section className="public-faq" aria-labelledby="public-faq-title"><h2 id="public-faq-title">常見問題</h2><dl><div><dt>如何開始使用？</dt><dd>點選登入工作區，使用已獲提供的登入資格；登入後即可查看該身分獲授權的聯盟。</dd></div><div><dt>這是 Yahoo 官方網站嗎？</dt><dd>這是獨立的 Fantasy 籃球分析工具，並非 Yahoo 官方服務。</dd></div><div><dt>會代替我操作球隊嗎？</dt><dd>不會。網站提供分析與模擬資訊，實際加退球員或選秀操作請在 Yahoo 確認。</dd></div><div><dt>如何了解模型分數？</dt><dd>登入後可查看模型指標旁的繁體中文說明，以及完整使用說明書；基礎統計與預估結果會區分呈現。</dd></div></dl></section>
      <footer className="public-footer"><p>Fantasy Basketball Desk · Yahoo Fantasy Basketball 分析工作區</p><Link href="/login" rel="nofollow">登入工作區 →</Link></footer>
    </div>
  </main>;
}
