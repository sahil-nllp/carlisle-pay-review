import { UploadModelClient } from "@/components/upload-model-client";

export default function UploadModelPage() {
  return (
    <div className="mx-auto max-w-4xl" style={{ animation: "slideUp 0.4s ease both" }}>
      <p className="mb-8 text-xs" style={{ color: "var(--neutral-500)" }}>
        Upload the approved Wage Model Excel file for the next financial year.
        All existing employee data may be replaced.
      </p>
      <UploadModelClient />
    </div>
  );
}
