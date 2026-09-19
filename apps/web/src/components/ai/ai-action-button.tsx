"use client";

import React from "react";

interface AiActionButtonProps {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "subtle";
  size?: "sm" | "md";
  className?: string;
}

export function AiActionButton({
  label,
  onClick,
  loading = false,
  disabled = false,
  variant = "secondary",
  size = "md",
  className = "",
}: AiActionButtonProps) {
  const baseClasses =
    "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed";

  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";

  const variantClasses =
    variant === "primary"
      ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
      : variant === "subtle"
      ? "bg-zinc-800/40 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60"
      : "bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-zinc-700 shadow-sm";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
    >
      {loading ? (
        <svg
          className="animate-spin h-3.5 w-3.5 text-indigo-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      ) : (
        <span className="text-indigo-400 font-bold text-xs">✦</span>
      )}
      <span>{label}</span>
    </button>
  );
}
