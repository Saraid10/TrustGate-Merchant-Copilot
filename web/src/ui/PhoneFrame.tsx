import { useEffect, useState, type ReactNode } from "react";
import { BatteryFull, Signal, Wifi } from "lucide-react";

const W = 390;
const H = 844;
const BEZEL = 12;
const TOP_BAR = 72;

function fitScale(reserve: number) {
  const byHeight = ((window.innerHeight - reserve) * 0.85) / (H + BEZEL * 2);
  const byWidth = (window.innerWidth * 0.38 - 48) / (W + BEZEL * 2);
  const byRoom = (window.innerHeight - TOP_BAR - 24 - reserve) / (H + BEZEL * 2);
  return Math.min(byHeight, byWidth, byRoom);
}

/** `reserve` is vertical space kept free below the stage, for the presenter bar. */
export function PhoneFrame({ children, reserve = 0 }: { children: ReactNode; reserve?: number }) {
  const [scale, setScale] = useState(() => fitScale(reserve));

  useEffect(() => {
    const onResize = () => setScale(fitScale(reserve));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [reserve]);

  const outerW = W + BEZEL * 2;
  const outerH = H + BEZEL * 2;

  return (
    <div style={{ width: outerW * scale, height: outerH * scale }} className="relative">
      <div
        className="absolute left-0 top-0 origin-top-left rounded-[56px] bg-gradient-to-b from-[#1A2233] to-[#07090E] shadow-[0_40px_90px_rgba(0,0,0,0.6),inset_0_0_0_1.5px_rgba(255,255,255,0.08)]"
        style={{ width: outerW, height: outerH, padding: BEZEL, transform: `scale(${scale})` }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[44px] bg-[var(--tg-app-bg)] text-[15px] text-[var(--tg-ink)]">
          <StatusBar />
          {children}
        </div>
      </div>
    </div>
  );
}

const clock = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?[ap]m$/i, "");

function StatusBar() {
  // Real time, so it agrees with the live record's timestamps.
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const t = setInterval(() => setTime(clock()), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between px-8 text-[14px] font-semibold">
      <span className="tabular">{time}</span>
      <span className="absolute left-1/2 top-3 h-[26px] w-[104px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1.5">
        <Signal size={15} strokeWidth={2.5} />
        <Wifi size={15} strokeWidth={2.5} />
        <BatteryFull size={20} strokeWidth={2} />
      </span>
    </div>
  );
}
