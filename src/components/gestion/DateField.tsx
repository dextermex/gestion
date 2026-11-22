"use client";

import { useState } from "react";
import { Input } from "@/components/pro/ui";
import { dayToText, maskDay, parseDay } from "@/lib/day-input";

/**
 * The product's own date field: day, month, year, the same on every
 * browser. It hands back an ISO day, or nothing while what is typed is not
 * a day within the bounds.
 */
export default function DateField({ value, onChange, min, max, disabled, className, placeholder, label }: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  placeholder: string;
  /** Read by assistive technology when no visible label wraps the field. */
  label?: string;
}) {
  const [text, setText] = useState(dayToText(value));
  // A day set from outside (a recognised invoice fills the form) is taken up; what is being typed is left alone.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value && value !== parseDay(text)) setText(dayToText(value));
  }
  const iso = parseDay(text);
  const bad = text !== "" && (!iso || (min !== undefined && iso < min) || (max !== undefined && iso > max));
  return (
    <Input
      type="text"
      data-day=""
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={bad || undefined}
      disabled={disabled}
      maxLength={10}
      className={(className ?? "") + " tabular-nums" + (bad ? " border-red-400" : "")}
      onChange={(e) => {
        const next = maskDay(e.target.value);
        setText(next);
        const day = parseDay(next);
        onChange(day && (min === undefined || day >= min) && (max === undefined || day <= max) ? day : "");
      }}
    />
  );
}
