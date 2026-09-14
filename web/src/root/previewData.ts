import type { PlatformOrgs } from "../lib/types";

/* `/root?preview=1` 用的示例机构，与 admin 的 previewData 同一个用途：
 * 不连数据库也能看界面、截图、走查。 */
export const ROOT_PREVIEW: PlatformOrgs = {
  orgs: [
    {
      id: "00000000-0000-0000-0000-0000000000a1",
      slug: "gcgc",
      name_zh: "格拉斯哥华人福音教会",
      name_en: "Glasgow Chinese Gospel Church",
      created_at: "2026-08-24T10:00:00Z",
      event_count: 3,
      last_event_at: "2026-08-27T19:40:00Z",
      has_live_event: true,
    },
    {
      id: "00000000-0000-0000-0000-0000000000a2",
      slug: "elcc",
      name_zh: "爱丁堡华人基督教会",
      name_en: "Edinburgh Chinese Christian Church",
      created_at: "2026-09-02T09:00:00Z",
      event_count: 1,
      last_event_at: "2026-09-05T18:30:00Z",
      has_live_event: false,
    },
  ],
};
