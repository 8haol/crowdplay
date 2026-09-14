import { useState } from "react";
import { errorText, rpc } from "../../lib/api";
import type { Station, StationLibrary } from "../../lib/types";
import { ErrorBanner } from "../../lib/ui";
import { Btn, Panel, PanelHead } from "../adminUi";
import { T } from "../adminTokens";
import { TYPE_ZH, stationRule } from "../adminUtils";
import { LibraryStationModal } from "../AdminDialogs";

/**
 * 「站点库」 — the organisation's own catalogue of stations.
 *
 * Two groups, because they obey different rules: the platform builtins are
 * shared by every church and read-only (copy one to get an editable version),
 * while custom rows belong to this organisation alone. Deleting is only
 * possible for a station no event has ever run; everything else is a rename.
 */
export function StationLibraryPanel({
  adminKey,
  library,
  preview,
  onDone,
}: {
  adminKey: string;
  library: StationLibrary;
  preview?: boolean;
  onDone: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Station | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guard = async (run: () => Promise<string>) => {
    setErr(null);
    if (preview) return onDone("演示模式不会写入数据");
    setBusy(true);
    try {
      onDone(await run());
    } catch (error) {
      setErr(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel className="overflow-hidden">
        <PanelHead
          eyebrow="站点库"
          title="本机构可用的全部站点"
          note="库是模板：改这里不会动任何已经办过的活动，每一场保留自己那份名称与计分方式。"
          actions={<Btn variant="primary" icon="plus" onClick={() => setCreating(true)}>新增站点</Btn>}
        />

        {err && <div className="px-5 pt-4"><ErrorBanner text={err} /></div>}

        <Group title="平台内置" note="所有机构共用，只读。要改名或改计分方式，先复制一份自己的。">
          {library.builtin.map((station) => (
            <Row key={station.id} station={station}>
              <Btn
                disabled={busy}
                onClick={() => guard(async () => {
                  await rpc("admin_library_copy", { p_admin_key: adminKey, p_station_id: station.id });
                  return `已复制「${station.name_zh}」到本机构站点`;
                })}
              >
                复制为自己的
              </Btn>
            </Row>
          ))}
        </Group>

        <Group title="本机构自建" note="只有本机构看得到，可以改名、改计分方式；被任何一场用过之后就只能改名。">
          {library.custom.length === 0 ? (
            <li className="px-5 py-6 text-center text-sm font-bold" style={{ color: T.inkFaint }}>
              还没有自建站点。复制一个内置站点，或者点右上角「新增站点」。
            </li>
          ) : (
            library.custom.map((station) => (
              <Row key={station.id} station={station}>
                {confirmDelete === station.id ? (
                  <>
                    <Btn
                      variant="dangerSolid"
                      disabled={busy}
                      onClick={() => guard(async () => {
                        await rpc("admin_library_delete", { p_admin_key: adminKey, p_station_id: station.id });
                        setConfirmDelete(null);
                        return `已删除「${station.name_zh}」`;
                      })}
                    >
                      确认删除
                    </Btn>
                    <Btn variant="quiet" onClick={() => setConfirmDelete(null)}>取消</Btn>
                  </>
                ) : (
                  <>
                    <Btn onClick={() => setEditing(station)}>编辑</Btn>
                    <Btn variant="danger" onClick={() => { setErr(null); setConfirmDelete(station.id); }}>删除</Btn>
                  </>
                )}
              </Row>
            ))
          )}
        </Group>
      </Panel>

      {(creating || editing) && (
        <LibraryStationModal
          adminKey={adminKey}
          station={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={(message) => { setCreating(false); setEditing(null); onDone(message); }}
        />
      )}
    </>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <>
      <div className="px-5 pb-2 pt-4" style={{ background: T.panelAlt }}>
        <div className="text-[11px] font-black tracking-[0.16em]" style={{ color: T.inkFaint }}>{title}</div>
        <p className="mt-1 text-xs font-semibold" style={{ color: T.inkSoft }}>{note}</p>
      </div>
      <ul className="divide-y" style={{ borderColor: T.lineSoft }}>{children}</ul>
    </>
  );
}

function Row({ station, children }: { station: Station; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-black">{station.name_zh}</div>
        <div className="text-[11px] font-bold" style={{ color: T.inkFaint }}>
          {TYPE_ZH[station.type]} · {stationRule(station.type, station.scoring_mode)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}
