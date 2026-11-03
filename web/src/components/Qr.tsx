"use client";

import { useEffect, useRef, useState } from "react";

/** The guest's account as a QR code, for the door. The code holds the plain account id. */
export function AccountQr({ account, size = 168 }: { account: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    import("qrcode").then((q) => q.toDataURL(account, { margin: 1, width: size * 2 }).then(setSrc));
  }, [account, size]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`QR code for ${account}`} width={size} height={size} className="rounded-xl bg-white p-1.5" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-xl bg-border/50" />
  );
}

/**
 * Reads guest QR codes with the camera. Calls `onScan` with each new code
 * (the same code is ignored for a few seconds so one guest isn't read twice).
 */
export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const last = { text: "", at: 0 };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = () => {
          if (stopped) return;
          const v = video.current;
          if (v && ctx && v.readyState >= 2) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            const text = code?.data.trim();
            if (text && (text !== last.text || Date.now() - last.at > 4000)) {
              last.text = text;
              last.at = Date.now();
              handler.current(text);
            }
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError(e instanceof Error && e.name === "NotAllowedError" ? "Camera access was blocked. Allow it in the browser and try again." : "Couldn't start the camera.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
        <video ref={video} muted playsInline className="w-full h-full object-cover" />
        <div className="absolute inset-[18%] border-2 border-white/80 rounded-2xl pointer-events-none" />
      </div>
      {error && <p className="text-sm text-warn">{error}</p>}
      <button className="btn btn-ghost w-full" onClick={onClose}>Stop scanning</button>
    </div>
  );
}
