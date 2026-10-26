import type { Metadata } from "next";

// Canonical origin is explicit: never trust a request Host header or a preview URL.
export const SITE_URL = "https://www.fantasybasketball.fun";
export const PRIVATE_ROBOTS = { index: false, follow: false } as const;
export const PUBLIC_HOME_METADATA: Metadata = {
  title: "Fantasy Basketball Desk｜Fantasy 籃球週報與補人分析",
  description: "Fantasy Basketball Desk 提供 Yahoo Fantasy Basketball 分類週報、球員補人分析、傷病機會觀察與選秀輔助。查看功能介紹，登入後使用獲授權的聯盟工作區。",
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    type: "website", locale: "zh_TW", url: `${SITE_URL}/`, siteName: "Fantasy Basketball Desk",
    title: "Fantasy Basketball Desk｜Fantasy 籃球分析工具",
    description: "Yahoo Fantasy Basketball 週報、補人分析與選秀輔助；私人聯盟資料須登入查看。",
  },
};
export const publicRobots = () => process.env.VERCEL_ENV === "preview"
  ? PRIVATE_ROBOTS : { index: true, follow: true };
