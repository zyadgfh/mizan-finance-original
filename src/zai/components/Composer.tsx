// File: src/zai/components/Composer.tsx
// Text input + attach/mic/send/stop. Drag&drop + paste supported. Arabic
// dictation via the Web Speech API (feature-detected; degrades silently).
import { useEffect, useRef, useState } from "react";
import { Paperclip, Mic, Send, Square } from "lucide-react";
import { validateFile } from "../lib/files";
import { toast } from "../lib/toast";
import type { AttachmentMeta } from "../types";

interface SpeechRecognitionLike extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
}

export function Composer({
  value, onChange, onSend, onStop, streaming, onAttachFiles, wide,
}: {
  value: string; onChange: (v: string) => void; onSend: () => void; onStop: () => void;
  streaming: boolean; onAttachFiles: (files: AttachmentMeta[]) => void; wide: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [dictating, setDictating] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(160, ta.scrollHeight) + "px";
  }, [value]);

  const readFiles = async (fileList: FileList | File[]) => {
    const metas: AttachmentMeta[] = [];
    for (const f of Array.from(fileList)) {
      const check = validateFile(f.name, f.type, f.size);
      const id = Math.random().toString(36).slice(2);
      if (!check.ok) { toast(`${f.name}: ${check.reason}`, "error"); continue; }
      const isImage = f.type.startsWith("image/");
      let dataUrl: string | undefined;
      if (isImage) dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
      metas.push({ id, name: f.name, kind: isImage ? "image" : "file", mime: f.type, size: f.size, dataUrl, scan: "ok" });
    }
    if (metas.length) onAttachFiles(metas);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); };
  const onPaste = (e: React.ClipboardEvent) => { if (e.clipboardData.files.length) readFiles(e.clipboardData.files); };

  const toggleDictation = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SR) { toast("الإملاء الصوتي غير مدعوم في هذا المتصفح", "error"); return; }
    if (dictating) { recRef.current?.stop(); setDictating(false); return; }
    const rec = new SR();
    rec.lang = "ar-SA"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onChange(text);
    };
    rec.onerror = () => setDictating(false);
    rec.onend = () => setDictating(false);
    rec.start();
    recRef.current = rec;
    setDictating(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSend(); }
  };

  return (
    <div className="zai-composer" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className={`zai-composer-inner ${wide ? "wide" : ""}`}>
        <button className="zai-icon-btn" aria-label="إرفاق ملف" onClick={() => fileRef.current?.click()}><Paperclip size={19} /></button>
        <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files) readFiles(e.target.files); e.target.value = ""; }} />
        <textarea
          ref={taRef} className="zai-input" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
          placeholder="اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد)" aria-label="نص الرسالة" rows={1}
        />
        <button className={`zai-icon-btn ${dictating ? "on" : ""}`} aria-pressed={dictating} aria-label="الإملاء الصوتي" onClick={toggleDictation} style={dictating ? { color: "var(--zai-error)" } : undefined}>
          <Mic size={19} />
        </button>
        {streaming ? (
          <button className="zai-send stop" aria-label="إيقاف" onClick={onStop}><Square size={18} /></button>
        ) : (
          <button className="zai-send" aria-label="إرسال" disabled={!value.trim()} onClick={onSend}><Send size={18} /></button>
        )}
      </div>
    </div>
  );
}
