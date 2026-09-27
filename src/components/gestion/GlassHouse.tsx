import { useId } from "react";

/** Decorative architectural glass object. Never used in place of a property's photograph. */
export default function GlassHouse({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return <svg className={`glass-house ${className}`} viewBox="0 0 260 230" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-front`} x1="46" y1="62" x2="195" y2="205" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" stopOpacity=".95" /><stop offset=".45" stopColor="#d4efff" stopOpacity=".8" /><stop offset="1" stopColor="#8fc5e5" stopOpacity=".9" /></linearGradient>
      <linearGradient id={`${id}-side`} x1="144" y1="84" x2="239" y2="182" gradientUnits="userSpaceOnUse"><stop stopColor="#acd9f2" stopOpacity=".7" /><stop offset="1" stopColor="#4184ac" stopOpacity=".8" /></linearGradient>
      <linearGradient id={`${id}-roof`} x1="74" y1="37" x2="223" y2="111" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" /><stop offset=".5" stopColor="#d7eeff" /><stop offset="1" stopColor="#86b8d7" /></linearGradient>
      <linearGradient id={`${id}-window`} x1="61" y1="114" x2="167" y2="204" gradientUnits="userSpaceOnUse"><stop stopColor="#83b5d4" /><stop offset="1" stopColor="#ecfaff" /></linearGradient>
      <radialGradient id={`${id}-shadow`}><stop stopColor="#307da5" stopOpacity=".3" /><stop offset="1" stopColor="#307da5" stopOpacity="0" /></radialGradient>
    </defs>
    <ellipse cx="136" cy="201" rx="119" ry="27" fill={`url(#${id}-shadow)`} />
    <path d="m30 162 91-49 116 58-91 49z" fill="#dbf2ff" fillOpacity=".55" stroke="#fff" strokeOpacity=".9" />
    <path d="m30 162 116 57v7L30 169z" fill="#b1d7eb" fillOpacity=".65" />
    <path d="m146 219 91-48v7l-91 48z" fill="#81b5d3" fillOpacity=".6" />
    <path d="m54 101 47-54 60 31 5 121-112-56z" fill={`url(#${id}-front)`} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="m166 112 64-34v87l-64 34z" fill={`url(#${id}-side)`} stroke="#e3f7ff" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="m101 47 65 65 64-34-63-63z" fill={`url(#${id}-roof)`} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    <path d="m101 47-50 55-7-4 56-63 73 73-7 4z" fill="#f3fbff" stroke="#d6edf9" strokeLinejoin="round" />
    <path d="m68 115 27 14v31l-27-14zM116 140l27 14v31l-27-14z" fill={`url(#${id}-window)`} stroke="#f4fcff" strokeWidth="2" strokeLinejoin="round" />
    <path d="m184 117 27-14v31l-27 14z" fill="#b8e3f9" fillOpacity=".75" stroke="#e4f6ff" strokeWidth="2" />
    <path d="m101 68 29 29M60 108v30M170 119v72" stroke="#fff" strokeOpacity=".85" strokeWidth="3" strokeLinecap="round" />
    <path d="m107 59 48 48M174 43l39 38" stroke="#fff" strokeOpacity=".35" strokeWidth="10" />
  </svg>;
}
