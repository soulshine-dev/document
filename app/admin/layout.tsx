import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "University Diploma Admin"
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
