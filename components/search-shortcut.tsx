"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
export function SearchShortcut() {
  const router=useRouter();
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if (target.isContentEditable||["INPUT","TEXTAREA","SELECT"].includes(target.tagName)) return;
      if (event.key==="/"||((event.metaKey||event.ctrlKey)&&event.key==="k")) {event.preventDefault();router.push("/search");}
    };
    document.addEventListener("keydown",key);return ()=>document.removeEventListener("keydown",key);
  },[router]);
  return null;
}
