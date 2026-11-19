// File: src/zai/components/Lightbox.tsx
import { useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCw, Download, Share2 } from "lucide-react";
import { toast } from "../lib/toast";

export function Lightbox({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!src) return;
    setZoom(1); setRot(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [src, onClose]);

  if (!src) return null;
  const download = () => { const a = document.createElement("a"); a.href = src; a.download = "image"; a.click(); };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ url: src }); } catch { /* cancelled */ } }
    else { await navigator.clipboard.writeText(src); toast("تم نسخ رابط الصورة", "ok"); }
  };

  return (
    <div className="zai-lightbox" role="dialog" aria-modal="true" aria-label={alt || "عرض الصورة"} tabIndex={-1} ref={ref}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <img src={src} alt={alt || "صورة مرفقة"} style={{ transform: `scale(${zoom}) rotate(${rot}deg)`, transition: "transform 150ms" }} />
      <div className="bar">
        <button aria-label="تصغير" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut size={18} /></button>
        <button aria-label="تكبير" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><ZoomIn size={18} /></button>
        <button aria-label="تدوير" onClick={() => setRot((r) => r + 90)}><RotateCw size={18} /></button>
        <button aria-label="تحميل" onClick={download}><Download size={18} /></button>
        <button aria-label="مشاركة" onClick={share}><Share2 size={18} /></button>
        <button aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
    </div>
  );
}
