import { useMemo } from "react";
import { errorText, rpc } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import type { StationLibrary } from "../../lib/types";
import { Btn, Panel, PageTitle } from "../adminUi";
import { T } from "../adminTokens";
import { PREVIEW_LIBRARY } from "../previewData";
import { StationLibraryPanel } from "./StationLibraryPanel";

/*
 * 机构的站点模板，跨场次复用——所以它属于机构层，不属于任何一场。
 * admin_station_library 的签名（只要口令，不要 event_id）本来就是这么说的。
 */
export function StationLibraryPage({
  adminKey,
  preview,
  onDone,
}: {
  adminKey: string;
  preview?: boolean;
  onDone: (message: string) => void;
}) {
  const pollFn = useMemo(
    () => () => rpc<StationLibrary>("admin_station_library", { p_admin_key: adminKey }),
    [adminKey],
  );
  const poll = usePoll<StationLibrary>(preview ? null : pollFn, 15_000);
  const data = preview ? PREVIEW_LIBRARY : poll.data;

  const done = (message: string) => { onDone(message); poll.refresh(); };

  return (
    <div>
      <PageTitle
        eyebrow="STATION LIBRARY"
        title="站点库"
        description="这间机构的站点模板，跨场次复用。新建一场活动时从这里挑，改这里不影响已经开始的场次。"
      />

      {!data ? (
        <Panel className="p-10 text-center">
          {poll.error ? (
            <>
              <h2 className="text-lg font-black">站点库读取失败</h2>
              <p className="mt-2 text-sm font-semibold" style={{ color: T.inkSoft }}>{errorText(poll.error)}</p>
              <div className="mt-4"><Btn variant="primary" onClick={poll.refresh}>重试</Btn></div>
            </>
          ) : (
            <div className="dots text-sm font-black" style={{ color: T.inkSoft }}>
              正在读取站点库<span>.</span><span>.</span><span>.</span>
            </div>
          )}
        </Panel>
      ) : (
        <StationLibraryPanel adminKey={adminKey} library={data} preview={preview} onDone={done} />
      )}
    </div>
  );
}
