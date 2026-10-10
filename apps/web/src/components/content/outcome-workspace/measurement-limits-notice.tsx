import {
  getMeasurementLimitsCopy,
  type MeasurementLimitsInput,
} from "@/lib/measurement-limits-copy";

/** 仅展示传入的来源、现有测量判定和归因限制；不请求或计算判定。 */
export function MeasurementLimitsNotice(props: MeasurementLimitsInput) {
  const copy = getMeasurementLimitsCopy(props);
  const warning = copy.tone === "warning";

  return (
    <section
      aria-label="测量来源与归因限制"
      className={`surface rounded-xl border px-4 py-3 ${
        warning ? "border-amber-300/70" : "border-slate-200/70"
      }`}
    >
      <p className={`text-sm font-semibold ${warning ? "text-amber-900" : "text-slate-800"}`}>
        {copy.title}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
        {copy.messages.map((message, index) => (
          <li key={`${index}-${message}`}>{message}</li>
        ))}
      </ul>
    </section>
  );
}
