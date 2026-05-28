export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // TODO: admin shell (auth gate in middleware)
  return <div className="flex-1 flex">{children}</div>;
}
