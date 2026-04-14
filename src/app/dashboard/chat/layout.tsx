export default function ChatLayout({ children }: { children: React.ReactNode }) {
  // Chat fills the full available height — override the parent's overflow-auto
  return <div className="flex flex-col h-full overflow-hidden">{children}</div>
}
