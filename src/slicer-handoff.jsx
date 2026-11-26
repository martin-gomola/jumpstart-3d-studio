import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { openToolWindow, closeToolWindow } from "./tool-window.js";
import { loadStoredX2DProfiles, readX2DProfiles, x2dFilamentLabel, X2D_DEFAULT_FILAMENT, X2D_PROFILE_KEY } from "./bambu-project.js";

function studioLink(id) {
  const file = encodeURIComponent(new URL(`/slicer-handoff/${id}/model.3mf`, location.origin).href);
  return /Macintosh|Mac OS X/.test(navigator.userAgent)
    ? `bambustudioopen://${file}`
    : `bambustudio://open?file=${file}`;
}

function Handoff({ prepare, filename, close, x2d }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState(() => (x2d ? loadStoredX2DProfiles(localStorage) : []));
  const [filament, setFilament] = useState(X2D_DEFAULT_FILAMENT);
  const profile = profiles.find(p => p.filament_settings_id[0] === filament) ?? profiles[0];
  const [job, setJob] = useState(x2d ? null : { profile: null });
  const busy = !!job && !result && !error;
  const open = useRef(null);
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    let download;
    async function build() {
      try {
        const bytes = await prepare(job.profile);
        if (controller.signal.aborted) return;
        if (!bytes) throw new Error("Select a printable body or add one to the design.");
        download = URL.createObjectURL(new Blob([bytes], { type: "model/3mf" }));
        const desktop = !/Android|iPhone|iPad|iPod/.test(navigator.userAgent) &&
          !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
        const server = document.querySelector('meta[name="jumpstart-slicer-handoff"]');
        let link;
        if (desktop && server) {
          try {
            const response = await fetch("/slicer-handoff", {
              method: "POST", signal: controller.signal,
              headers: { "Content-Type": "model/3mf" }, body: bytes,
            });
            if (!response.ok) throw new Error("Handoff unavailable");
            const { id } = await response.json();
            if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id)) throw new Error("Invalid export link");
            link = studioLink(id);
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        if (!controller.signal.aborted) setResult({ download, link });
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message || "Couldn't prepare the 3MF.");
      }
    }
    void build();
    return () => {
      controller.abort();
      if (download) URL.revokeObjectURL(download);
    };
  }, [prepare, job]);
  useEffect(() => { if (result) open.current?.focus(); }, [result]);
  async function loadProfiles(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("The profile pack is too large.");
      const raw = await file.text();
      const loaded = readX2DProfiles(raw);
      try { localStorage.setItem(X2D_PROFILE_KEY, raw); } catch {}
      setProfiles(loaded);
      setJob(null);
      setResult(null);
      setError("");
    } catch (e) { setError(e.message || "Couldn't read the profile pack."); }
  }

  return <div className="modal slicer-handoff">
    <header><h2 id="slicer-handoff-title">{x2d ? "Export X2D project" : "Open in Bambu Studio"}</h2></header>
    <div className="mbody">
      {x2d && <>
        <p>Bambu Lab X2D 0.4 mm · 0.20 mm Standard</p>
        <label>{profiles.length ? "Replace X2D profile pack" : "Load X2D profile pack"} <input type="file" accept=".json,application/json" disabled={busy} onChange={loadProfiles} /></label>
        {profile && <p>Build plate: {profile.curr_bed_type}</p>}
        {profile && <fieldset disabled={busy}>
          <legend>Filament</legend>
          {profiles.map(p => {
            const name = p.filament_settings_id[0];
            return <label className="slicer-filament" key={name}><input type="radio" name="x2d-filament" checked={p === profile} onChange={() => {
              setFilament(name); setJob(null); setResult(null); setError("");
            }} /> {x2dFilamentLabel(p)}</label>;
          })}
        </fieldset>}
      </>}
      <p role="status">{error || (result
        ? result.link ? "Your 3MF is ready. The desktop link expires in 5 minutes." : "Download the 3MF and open it in Bambu Studio."
        : busy ? "Preparing the 3MF…" : "")}</p>
      <div className="slicer-handoff-actions">
        <button className="btn" type="button" onClick={close}>Close</button>
        {x2d && !result && <button className="btn primary" type="button" disabled={!profile || busy} onClick={() => {
          setError(""); setResult(null); setJob({ profile });
        }}>Prepare project</button>}
        {result && <a ref={result.link ? null : open} className="btn" href={result.download} download={filename}>Download 3MF</a>}
        {result?.link && <a ref={open} className="btn primary" href={result.link}>Open Bambu Studio</a>}
      </div>
    </div>
  </div>;
}

export function openSlicerHandoff(prepare, filename, { x2d = false } = {}) {
  const host = document.createElement("div");
  host.className = "modal-back";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-labelledby", "slicer-handoff-title");
  document.body.append(host);
  const root = createRoot(host);
  const close = () => { closeToolWindow(host); root.unmount(); host.remove(); };
  host.onclick = (event) => { if (event.target === host) close(); };
  root.render(<Handoff prepare={prepare} filename={filename} close={close} x2d={x2d} />);
  openToolWindow(host, close);
}
