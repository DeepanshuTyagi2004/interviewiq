export default function AppLayout({ children }: { children: React.ReactNode }) {
  // TODO: app shell (sidebar, topbar, auth gate handled in middleware)
  return <div className="flex-1 flex">{children}</div>;
}
