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
  const baseClasses = "ui-button ai-action-button";
  const sizeClasses = size === "sm" ? "compact" : "";
  const variantClasses =
    variant === "primary"
      ? "primary"
      : variant === "subtle"
      ? "tertiary"
      : "secondary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
    >
      <span className="ai-label" aria-hidden="true">AI</span>
      <span>{loading ? "生成中…" : label}</span>
    </button>
  );
}
