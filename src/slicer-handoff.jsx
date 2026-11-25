import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { openToolWindow, closeToolWindow } from "./tool-window.js";

function studioLink(id) {
  const file = encodeURIComponent(new URL(`/slicer-handoff/${id}/model.3mf`, location.origin).href);
  return /Macintosh|Mac OS X/.test(navigator.userAgent)
    ? `bambustudioopen://${file}`
    : `bambustudio://open?file=${file}`;
}

function Handoff({ prepare, filename, close }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const open = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    let download;
    async function build() {
      try {
        const bytes = await prepare();
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
      } catch {
        if (!controller.signal.aborted) setError("Couldn't prepare a 3MF. Check that the design has printable bodies.");
      }
    }
    void build();
    return () => {
      controller.abort();
      if (download) URL.revokeObjectURL(download);
    };
  }, [prepare]);
  useEffect(() => { if (result) open.current?.focus(); }, [result]);

  return <div className="modal slicer-handoff">
    <header><h2 id="slicer-handoff-title">Open in Bambu Studio</h2></header>
    <div className="mbody">
      <p role="status">{error || (result
        ? result.link ? "Your 3MF is ready. The desktop link expires in 5 minutes." : "Download the 3MF and open it in Bambu Studio."
        : "Preparing the 3MF…")}</p>
      <div className="slicer-handoff-actions">
        <button className="btn" type="button" onClick={close}>Close</button>
        {result && <a ref={result.link ? null : open} className="btn" href={result.download} download={filename}>Download 3MF</a>}
        {result?.link && <a ref={open} className="btn primary" href={result.link}>Open Bambu Studio</a>}
      </div>
    </div>
  </div>;
}

export function openSlicerHandoff(prepare, filename) {
  const host = document.createElement("div");
  host.className = "modal-back";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-labelledby", "slicer-handoff-title");
  document.body.append(host);
  const root = createRoot(host);
  const close = () => { closeToolWindow(host); root.unmount(); host.remove(); };
  host.onclick = (event) => { if (event.target === host) close(); };
  root.render(<Handoff prepare={prepare} filename={filename} close={close} />);
  openToolWindow(host, close);
}
