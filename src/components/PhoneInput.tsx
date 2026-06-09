"use client";

import { useState } from "react";
import { formatRuPhone, isValidRuPhone, phoneDigits } from "@/lib/phone";

type PhoneInputProps = {
  id?: string;
  name?: string;
  required?: boolean;
  className?: string;
};

export function PhoneInput({
  id = "phone",
  name = "phone",
  required = true,
  className = "input-field",
}: PhoneInputProps) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  function update(next: string) {
    const digits = phoneDigits(next);
    if (digits.length <= 1) {
      setValue("");
      return;
    }
    setValue(formatRuPhone(digits));
  }

  const invalid = touched && !isValidRuPhone(value);

  return (
    <div>
      <input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required={required}
        value={value}
        placeholder="+7 (___) ___-__-__"
        className={`${className}${invalid ? " border-red-500 ring-1 ring-red-500/30" : ""}`}
        onChange={(e) => update(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={invalid}
      />
      {invalid && (
        <p className="mt-1 text-xs text-red-600">
          Введите номер полностью: +7 (9XX) XXX-XX-XX
        </p>
      )}
    </div>
  );
}
