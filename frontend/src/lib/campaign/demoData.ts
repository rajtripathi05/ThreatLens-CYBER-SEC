import type { CampaignRecord } from "./quality";

/**
 * FICTIONAL sample data for the guided demo workspace. Every host is a reserved .example name; nothing here is real traffic,
 * and nothing is ever fetched. The set deliberately contains tagging mistakes so the validator has real findings to show.
 */
export const DEMO_DESTINATION = "https://threatlens.example/launch?ref=home#pricing";
export const DEMO_CAMPAIGN = "threatlens_launch";

const T = (day: number) => `2026-03-${String(day).padStart(2, "0")}T09:00:00.000Z`;
const e = encodeURIComponent;
const u = (src: string, med: string, camp: string, extra = "", page = "https://threatlens.example/launch") =>
  `${page}?${[src && `utm_source=${e(src)}`, med && `utm_medium=${e(med)}`, camp && `utm_campaign=${e(camp)}`, extra].filter(Boolean).join("&")}`;

const ROWS: [string, string, string, number][] = [
  ["Launch email · hero button", u("newsletter", "email", DEMO_CAMPAIGN, "utm_content=hero_cta"), "Sent to the beta list", 2],
  ["LinkedIn post · founder", u("linkedin", "social", DEMO_CAMPAIGN, "utm_content=founder_post"), "Organic post", 3],
  ["LinkedIn sponsored", u("LinkedIn", "paid-social", DEMO_CAMPAIGN), "Capital L: a naming-consistency problem", 4],
  ["Search ads · brand", u("google", "cpc", DEMO_CAMPAIGN, "utm_term=threat+intelligence"), "", 5],
  ["Search ads · generic", u("google", "cpc", DEMO_CAMPAIGN, "utm_term=phishing+url+checker&utm_content=ad_b"), "", 6],
  ["Facebook group post", u("facebook", "social", DEMO_CAMPAIGN), "", 7],
  ["Facebook (older spelling)", u("face_book", "social", DEMO_CAMPAIGN), "Spelling variant of facebook", 8],
  ["Partner newsletter", u("partner news", "email", DEMO_CAMPAIGN), "Contains a space", 9],
  ["Docs footer link", u("docs", "", DEMO_CAMPAIGN, "", "https://threatlens.example/docs"), "Medium was forgotten", 10],
  ["Instagram story", u("instagram", "social", DEMO_CAMPAIGN, "utm_content=story_1"), "", 11],
  ["Launch email · hero button (copy)", u("newsletter", "email", DEMO_CAMPAIGN, "utm_content=hero_cta"), "Accidentally saved twice", 12],
  ["Blog referral", u("security-blog", "referral", DEMO_CAMPAIGN), "", 13],
];

/** Stable ids and timestamps so the demo is deterministic. */
export function demoSeed(): CampaignRecord[] {
  return ROWS.map(([name, finalUrl, note, day], i) => ({ id: `DEMO-${String(i + 1).padStart(2, "0")}`, name, finalUrl, note, createdUtc: T(day), updatedUtc: T(day) }));
}

/** A small CSV for the "import" step: 3 good rows, one duplicate of an existing demo row, and 2 broken rows. */
export const DEMO_SAMPLE_CSV = [
  "name,url,utm_source,utm_medium,utm_campaign,utm_content,note",
  "Podcast sponsor,https://threatlens.example/launch,podcast,audio,threatlens_launch,,Fictional sponsor read",
  "Reddit AMA,https://threatlens.example/launch?ref=ama,reddit,social,threatlens_launch,ama_thread,",
  "Webinar invite,https://threatlens.example/webinar,webinar,email,threatlens_launch,,",
  "Newsletter hero (already in demo),https://threatlens.example/launch,newsletter,email,threatlens_launch,hero_cta,Duplicate of an existing row",
  "Missing scheme,threatlens.example/launch,x,y,z,,",
  ",,,,,,",
].join("\r\n") + "\r\n";
