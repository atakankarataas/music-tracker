"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import styles from "./year-stories.module.css";

export type YearStory = { label: string; headline: string; detail: string; color: string };
export function YearStories({ stories, year, range }: { stories: YearStory[]; year: number; range: string }) {
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState("");
  const story = stories[active];
  function download() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = story.color; ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = "#172015";
    ctx.font = "bold 30px sans-serif"; ctx.fillText(`atakan.fm / WRAPPED ${year}`, 80, 100);
    ctx.font = "26px sans-serif"; ctx.fillText(story.label.toUpperCase(), 80, 350);
    const wrap = (text: string, y: number, size: number, maxWidth: number) => {
      ctx.font = `bold ${size}px sans-serif`;
      let line = "";
      for (const word of text.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width > maxWidth && line) { ctx.fillText(line, 80, y); y += size * 1.15; line = word; }
        else line = candidate;
      }
      ctx.fillText(line, 80, y); return y + size * 1.5;
    };
    const titleSize = Math.min(110, 900 / Math.max(1, ...story.headline.split(" ").map(w => w.length)) * 1.4);
    const bottom = wrap(story.headline, 490, titleSize, 900);
    wrap(story.detail, Math.max(850, bottom + 60), 32, 900);
    ctx.font = "24px sans-serif"; ctx.fillText(range, 80, 1210);
    ctx.fillText("My recorded listening · unofficial archive recap", 80, 1260);
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `atakan-fm-${year}-${active + 1}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Card downloaded. Nothing was posted or shared.");
    }, "image/png");
  }
  return <section className={styles.deck} aria-label="Your Wrapped stories">
    <div className={styles.card} style={{ backgroundColor: story.color }} tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowRight") {event.preventDefault();setActive((active + 1) % stories.length);}
        if (event.key === "ArrowLeft") {event.preventDefault();setActive((active + stories.length - 1) % stories.length);}
      }}>
      <div className={styles.progress}>{stories.map((item, i) => <button key={item.label} aria-label={`Show ${item.label}`} aria-pressed={i === active} onClick={() => setActive(i)} />)}</div>
      <div className={styles.story} aria-live="polite"><span>{String(active + 1).padStart(2, "0")} / {story.label}</span><h2>{story.headline}</h2><p>{story.detail}</p></div>
      <div className={styles.controls}><span>YOUR YEAR, IN STORIES</span><div><button aria-label="Previous story" onClick={() => setActive((active + stories.length - 1) % stories.length)}><ArrowLeft size={20} /></button><button aria-label="Next story" onClick={() => setActive((active + 1) % stories.length)}><ArrowRight size={20} /></button></div></div>
    </div>
    <div className={styles.caption}><p>Keep a little piece of your year. Download the current card as a PNG.</p><button onClick={download}><Download size={16} /> Save card</button></div>
    <span className={styles.notice} role="status">{notice}</span>
  </section>;
}
