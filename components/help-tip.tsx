"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HELP, statDescription, type HelpKey, type StatContext } from "@/lib/help-content";

export function HelpTip({ topic, label, text }: { topic: HelpKey; label?: string; text?: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const pinned = useRef(false);
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  const close = () => { cancelClose(); pinned.current = false; setOpen(false); };
  const leave = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!pinned.current && document.activeElement !== trigger.current && !panel.current?.matches(":hover") && !trigger.current?.matches(":hover")) setOpen(false);
    }, 160);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const button = trigger.current?.getBoundingClientRect();
      if (!button || !panel.current) return;
      const rect = panel.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(button.left, innerWidth - rect.width - 8));
      const below = button.bottom + 8;
      const preferredTop = below + rect.height <= innerHeight - 8 ? below : button.top - rect.height - 8;
      const top = Math.max(8, Math.min(preferredTop, innerHeight - rect.height - 8));
      setPosition({ left, top });
    };
    const frame = requestAnimationFrame(place);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { pinned.current = false; setOpen(false); }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); pinned.current = false; setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, topic, label, text]);
  return <span className="help-anchor" data-help-topic={topic}>
    <button ref={trigger} type="button" className="help-trigger" aria-label={`${label ?? HELP[topic][1]} 說明`} aria-describedby={open ? id : undefined} aria-expanded={open}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") { cancelClose(); setOpen(true); } }} onPointerLeave={leave}
      onFocus={() => { cancelClose(); setOpen(true); }} onBlur={() => { pinned.current = false; leave(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (pinned.current) close(); else { pinned.current = true; cancelClose(); setOpen(true); } }}
      onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) event.stopPropagation(); }}>ⓘ</button>
    {open && createPortal(<div ref={panel} role="tooltip" id={id} lang="zh-Hant" className="help-tooltip" style={position} onPointerEnter={cancelClose} onPointerLeave={leave}>
      <strong>{label ?? HELP[topic][1]}</strong><p>{text ?? HELP[topic][2]}</p>
    </div>, document.body)}
  </span>;
}
export function StatHelp({ id, name, context }: { id: string; name: string; context: StatContext }) {
  return <HelpTip topic="stats" label={name} text={statDescription(id, name, context)} />;
}
