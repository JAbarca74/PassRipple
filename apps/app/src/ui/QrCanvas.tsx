// Draws a credential as a QR code on a canvas (version 10, level M, ADR 0013). The text is
// Base45, all in the QR alphanumeric set, so the library picks alphanumeric mode.
import QRCode from "qrcode";
import { useEffect, useRef } from "react";

export function QrCanvas({ text, label }: { text: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    void QRCode.toCanvas(canvas.current, text, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 288,
    });
  }, [text]);
  return <canvas ref={canvas} role="img" aria-label={label} className="mx-auto max-w-full" />;
}
