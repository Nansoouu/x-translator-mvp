"use client";

import { useEffect, useState, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface CountersData {
  total_videos: number;
  total_duration_s: number;
  unique_languages: number;
  active_users_today: number;
  today_videos: number;
  trend_pct: number;
}

interface AnimatedDigitProps {
  target: number;
  suffix?: string;
}

function AnimatedDigit({ target, suffix = "" }: AnimatedDigitProps) {
  const [current, setCurrent] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) {
      setCurrent(0);
      return;
    }
    const duration = Math.min(1500, Math.max(600, target * 15));
    startRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = Math.round(eased * target);
      setCurrent(val);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setCurrent(target);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  const str = current.toLocaleString() + suffix;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from(str).map((char, i) => (
        <span
          key={`${i}-${char}-${current}`}
          className="flip-digit"
        >
          {char}
        </span>
      ))}
    </div>
  );
}

export default function CountersBar() {
  const [data, setData] = useState<CountersData>({
    total_videos: 0,
    total_duration_s: 0,
    unique_languages: 0,
    active_users_today: 0,
    today_videos: 0,
    trend_pct: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const r = await fetch(`${API}/stats/counters`);
        if (r.ok) setData(await r.json());
      } catch {}
    };
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-center gap-6 md:gap-16 flex-wrap">
      {/* Vidéos */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-2xl">🎬</span>
        <AnimatedDigit target={data.total_videos} />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-medium">
            Vidéos traduites
          </span>
          {data.trend_pct !== 0 && (
            <span className={`text-[10px] font-bold ${data.trend_pct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data.trend_pct > 0 ? '↑' : '↓'}{Math.abs(data.trend_pct)}%
            </span>
          )}
        </div>
      </div>

      {/* Barre séparatrice */}
      <div className="hidden sm:block w-px h-16 bg-gray-800" />

      {/* Minutes */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-2xl">⏱️</span>
        <AnimatedDigit target={Math.round(data.total_duration_s / 60)} />
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-medium">
          Minutes de contenu
        </span>
      </div>

      {/* Barre séparatrice */}
      <div className="hidden sm:block w-px h-16 bg-gray-800" />

      {/* Aujourd'hui */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-2xl">⚡</span>
        <AnimatedDigit target={data.today_videos} />
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-medium">
          Aujourd'hui
        </span>
      </div>
    </div>
  );
}
